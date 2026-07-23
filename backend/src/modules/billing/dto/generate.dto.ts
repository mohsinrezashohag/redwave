import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

/**
 * Generate a client statement / commission invoice for a client + BILLING WEEK. — SRS BILL-002
 * The client id comes from the route (`/v1/clients/{id}/...`); the body carries the period.
 */
export class GenerateBillingDto {
  @ApiProperty({
    description:
      'The BILLING week to bill — Mon–Sun, "Bill 17" (governs which sales by sale_date, #7). Deliberately not ' +
      'the pay period: pay periods are Sun–Sat biweekly, so a bill straddles two of them.',
  })
  @IsUUID()
  billing_period_id!: string;

  @ApiPropertyOptional({
    example: '1.36500000',
    description:
      'FX override (decimal string, up to 8 dp): the confirmed currency→CAD rate to FREEZE at issue for a FOREIGN client. Omitted → the FX source supplies it; if neither, issuing a foreign document is rejected (422). Ignored for CAD clients.',
  })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,8})?$/, { message: 'fx_rate must be a decimal string with up to 8 decimal places' })
  fx_rate?: string;
}
