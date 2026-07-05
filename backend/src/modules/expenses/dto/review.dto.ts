import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export enum ReviewDecision {
  approve = 'approve',
  reject = 'reject',
  send_back = 'send_back',
}

/**
 * Approver's decision on a submitted report. — SRS EXP-006
 * `approve` → status `approved` (sets approved_by/at; enters the pay-run net for its period).
 * `reject` / `send_back` → returned for correction (editable again).
 */
export class ReviewDto {
  @ApiProperty({ enum: ReviewDecision })
  @IsEnum(ReviewDecision)
  decision!: ReviewDecision;

  @ApiPropertyOptional({ description: 'Optional note (reason for rejection / send-back).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    example: '1.36500000',
    description:
      "FX override (decimal string, up to 8 dp): the confirmed original→CAD rate to FREEZE when approving a FOREIGN expense. Omitted → the FX source (Bank of Canada) supplies it; if neither, approving a foreign item is rejected (422). Ignored for CAD items.",
  })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,8})?$/, { message: 'fx_rate must be a decimal string with up to 8 decimal places' })
  fx_rate?: string;
}
