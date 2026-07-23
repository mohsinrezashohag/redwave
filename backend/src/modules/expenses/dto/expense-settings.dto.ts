/**
 * Org-level expense settings — the office address a km trip runs from (SRS EXP-004). Coordinates are
 * captured when the address is set through a Places lookup, so the defaulted stop carries real lat/lng and
 * the server can derive the route distance; without them the stop falls back to the typed total, exactly
 * like a manually entered address.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const COORD = /^-?\d{1,3}(\.\d{1,6})?$/;

export class UpdateExpenseSettingsDto {
  @ApiPropertyOptional({
    example: '1250 Portage Ave, Winnipeg, MB R3G 0T7',
    description: 'The office a km trip starts from. Send an empty string to clear it (also clears the coordinates).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  office_address?: string;

  @ApiPropertyOptional({ example: '49.885' , description: 'Decimal string; from the Places lookup.' })
  @IsOptional()
  @Matches(COORD, { message: 'office_lat must be a decimal string' })
  office_lat?: string;

  @ApiPropertyOptional({ example: '-97.196', description: 'Decimal string; from the Places lookup.' })
  @IsOptional()
  @Matches(COORD, { message: 'office_lng must be a decimal string' })
  office_lng?: string;
}

export class ExpenseSettingsResponse {
  @ApiProperty({ type: String, nullable: true, example: '1250 Portage Ave, Winnipeg, MB R3G 0T7' })
  office_address!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Decimal string, or null when not geocoded.' })
  office_lat!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Decimal string, or null when not geocoded.' })
  office_lng!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: Date;
}
