import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { FIELD_TYPES, FieldType } from '../field-schema.logic';

const KEY = /^[a-z][a-z0-9_]*$/;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

/**
 * One per-type FIELD definition (EXP-002a). Config-driven capture field for a category — a `required`
 * field missing → Alert (blocks save); a numeric `soft_cap` exceeded → Warning (EXP-013).
 */
export class ExpenseFieldDefDto {
  @ApiProperty({ example: 'vendor', description: 'Snake_case field key (unique within the category).' })
  @Matches(KEY, { message: 'field key must be snake_case' })
  @MaxLength(40)
  key!: string;

  @ApiProperty({ example: 'Vendor' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @ApiProperty({ enum: FIELD_TYPES, example: 'text' })
  @IsEnum(FIELD_TYPES as unknown as Record<string, string>, { message: `type must be one of: ${FIELD_TYPES.join(', ')}` })
  type!: FieldType;

  @ApiProperty({ example: true, description: 'Missing on save → Alert (blocks save).' })
  @IsBoolean()
  required!: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Options for a select field.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  options?: string[];

  @ApiPropertyOptional({ example: '20.00', description: 'Numeric/money soft cap → Warning when exceeded (EXP-013).' })
  @IsOptional()
  @Matches(DECIMAL, { message: 'soft_cap must be a decimal string' })
  soft_cap?: string;
}

/**
 * Create / configure an expense category in the catalogue. — SRS EXP-002a/EXP-009
 * `requires_receipt` drives the receipt Alert; `fields` is the per-type field schema; `amount_soft_cap`
 * is a category-level soft cap on the item amount (→ Warning). (Items are bound to the ExpenseCategory
 * enum, so a new key beyond the 7 enum values is catalogue-only until an enum migration — CLAUDE §12.)
 */
export class CreateFieldConfigDto {
  @ApiProperty({ example: 'parking', description: 'Snake_case category key (unique).' })
  @Matches(KEY, { message: 'category_key must be snake_case (lowercase letters, digits, underscores)' })
  @MaxLength(40)
  category_key!: string;

  @ApiProperty({ example: 'Parking' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @ApiProperty({ example: true, description: 'Whether items in this category require a receipt.' })
  @IsBoolean()
  requires_receipt!: boolean;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ type: [ExpenseFieldDefDto], description: 'The per-type capture fields (EXP-002a).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ExpenseFieldDefDto)
  fields?: ExpenseFieldDefDto[];

  @ApiPropertyOptional({ example: '30.00', description: 'Category-level soft cap on the item amount → Warning (EXP-013).' })
  @IsOptional()
  @Matches(DECIMAL, { message: 'amount_soft_cap must be a decimal string' })
  amount_soft_cap?: string;
}

/** Update an existing category's config (all fields optional; the key is the route param). */
export class UpdateFieldConfigDto {
  @ApiPropertyOptional({ example: 'Meals' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requires_receipt?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ type: [ExpenseFieldDefDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ExpenseFieldDefDto)
  fields?: ExpenseFieldDefDto[];

  @ApiPropertyOptional({ example: '30.00', nullable: true, description: 'A decimal string, or null to clear the cap.' })
  @IsOptional()
  @Matches(DECIMAL, { message: 'amount_soft_cap must be a decimal string' })
  amount_soft_cap?: string | null;
}
