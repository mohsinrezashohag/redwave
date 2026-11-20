import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

/** Configurable ADP export (no fixed external format imposed). — SRS PAY-010 */
export class ExportPayRunDto {
  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'csv', description: 'Export format.' })
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';

  @ApiPropertyOptional({
    description:
      'Export only this rep. The ADP file pays whole reps, so it filters by rep; for one client, generate the ' +
      'report for that client (or use the payroll workbook filter).',
  })
  @IsOptional()
  @IsUUID()
  rep_id?: string;
}
