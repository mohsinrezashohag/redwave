/**
 * Shared expense-item input shapes — one expense ITEM (the atomic unit, item-first). `km` items carry a
 * km log (the amount is COMPUTED server-side, never trusted from the client #1); all others carry an
 * `amount` and (per the category config) a `receipt_url`. Reused by create + edit. — SRS §11
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategory, TripType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const MONEY = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d{1,6})?$/; // km — exact decimal string, never float (#1)
const SIGNED_DECIMAL = /^-?\d+(\.\d{1,6})?$/; // lat/lng may be negative

/** One stop on a kilometre route (address + coordinates; coordinates come from Places geocoding). */
export class KmStopInput {
  @ApiProperty({ example: 0, description: 'Order of this stop along the route (0-based).' })
  @IsInt()
  @Min(0)
  stop_order!: number;

  @ApiProperty({ example: '123 Main St, Winnipeg' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  address!: string;

  @ApiProperty({ example: '49.895100', description: 'Latitude (decimal string).' })
  @Matches(SIGNED_DECIMAL, { message: 'lat must be a decimal string' })
  lat!: string;

  @ApiProperty({ example: '-97.138400', description: 'Longitude (decimal string).' })
  @Matches(SIGNED_DECIMAL, { message: 'lng must be a decimal string' })
  lng!: string;
}

/** Kilometre log for a `km` item. `total_km` is INDICATIVE — when a Maps key is configured the server
 *  re-derives the authoritative route distance from the stops' coordinates (else this value is used). */
export class KmLogInput {
  @ApiProperty({ enum: TripType, example: 'round' })
  @IsEnum(TripType)
  trip_type!: TripType;

  @ApiProperty({ example: '130.00', description: "Indicative total route distance (km). The server re-derives it from the stops when Maps is configured." })
  @Matches(DECIMAL, { message: 'total_km must be a decimal string' })
  total_km!: string;

  @ApiProperty({ type: [KmStopInput] })
  @IsArray()
  @ArrayMinSize(2) // a trip needs at least an origin + a destination
  @ValidateNested({ each: true })
  @Type(() => KmStopInput)
  stops!: KmStopInput[];
}

/** One expense item. */
export class ExpenseItemInput {
  @ApiProperty({ enum: ExpenseCategory, example: 'meals' })
  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @ApiPropertyOptional({ description: 'Optional client this expense is attributed to.' })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiProperty({ example: '2026-03-10', description: 'Governs the payout pay period (EXP-009).' })
  @Matches(DATE, { message: 'expense_date must be a YYYY-MM-DD date' })
  expense_date!: string;

  @ApiPropertyOptional({
    example: '42.50',
    description: 'Amount (decimal string) in `currency`. Required for non-km items; ignored for km (server-computed, CAD).',
  })
  @IsOptional()
  @Matches(MONEY, { message: 'amount must be a decimal string with up to 2 decimal places' })
  amount?: string;

  @ApiPropertyOptional({
    example: 'CAD',
    description:
      'Currency the amount is in (ISO 4217; default CAD). A foreign amount freezes its FX rate + CAD value at APPROVAL (#12). km items are always CAD.',
  })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code' })
  currency?: string;

  @ApiPropertyOptional({
    description:
      'Personal / do-not-reimburse (EXP-012). Excluded from the reimbursable total, the pay run, and all client output. Default false.',
  })
  @IsOptional()
  @IsBoolean()
  is_personal?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Custom free-form tags (client + channel, EXP-002a). Up to 20 tags, ≤50 chars each.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @ApiProperty({ example: 'Lunch with client' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { vendor: 'Tim Hortons', city: 'Winnipeg' },
    description:
      'Per-type CAPTURE fields as a { key: value } object, keyed by the category schema (EXP-002a). METADATA ONLY — never summed into the amount (#1). Unknown keys are dropped server-side.',
  })
  @IsOptional()
  @IsObject()
  field_values?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Object-storage reference (from the receipt upload); mandatory per the category config.' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  receipt_url?: string;

  @ApiPropertyOptional({ type: KmLogInput, description: 'Required for `km` items; forbidden otherwise.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => KmLogInput)
  km?: KmLogInput;
}
