import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ExportLayoutColumnDto {
  @ApiProperty({ example: 'internet_rate', description: 'A field key from this report type\u2019s registry.' })
  @IsString()
  field!: string;

  @ApiPropertyOptional({ example: 'Internet Rate', description: 'Rename the column; omit to keep the default.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  header?: string;
}

export class SaveExportLayoutDto {
  @ApiProperty({ example: 'Redwave payroll — no address column' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    example: 'payroll',
    description:
      "Which report this lays out: payroll | statement | sales | expenses. A field belonging to another " +
      'report is rejected \u2014 that boundary is what keeps the two rate streams apart (#3).',
  })
  @IsString()
  report_type!: string;

  @ApiPropertyOptional({ description: 'Scope to one client; omit for the report-wide layout.' })
  @IsOptional()
  @IsUUID()
  client_id?: string;

  @ApiProperty({ type: [ExportLayoutColumnDto], description: 'Ordered columns.' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExportLayoutColumnDto)
  columns!: ExportLayoutColumnDto[];
}
