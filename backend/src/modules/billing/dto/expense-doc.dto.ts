import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID, Matches } from 'class-validator';

/**
 * Generate / preview a client EXPENSE billing document for a client + pay period. — SRS BILL-012 / EXP-014
 * The client id comes from the route (`/v1/clients/{id}/expense-documents`); the body carries the period +
 * the dynamic selection (which reps / days to include — empty = everything in scope).
 */
export class GenerateExpenseDocDto {
  @ApiProperty({ description: 'The pay period to bill (an expense item is in-scope by its own expense_date, EXP-009).' })
  @IsUUID()
  pay_period_id!: string;

  @ApiPropertyOptional({ type: [String], description: 'Include only these reps (rep ids). Empty/omitted = all reps with in-scope expenses.' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  rep_ids?: string[];

  @ApiPropertyOptional({ type: [String], example: ['2026-01-10'], description: "Include only these days ('YYYY-MM-DD'). Empty/omitted = all in-scope days." })
  @IsOptional()
  @IsArray()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true, message: 'each date must be YYYY-MM-DD' })
  dates?: string[];

  @ApiPropertyOptional({
    example: '1.36500000',
    description:
      'FX override (decimal string, up to 8 dp): the confirmed currency→CAD rate to FREEZE at issue for a FOREIGN client. Omitted → the FX source supplies it; if neither, issuing a foreign document is rejected (422). Ignored for CAD clients.',
  })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,8})?$/, { message: 'fx_rate must be a decimal string with up to 8 decimal places' })
  fx_rate?: string;
}
