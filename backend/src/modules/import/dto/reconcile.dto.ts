import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export enum ReconcileAction {
  match = 'match',
  edit = 'edit',
  ignore = 'ignore',
}

/** One row resolution. — SRS §15 (IMP-005) */
export class RowResolution {
  @ApiProperty({ description: 'The import row to resolve.' })
  @IsUUID()
  row_id!: string;

  @ApiProperty({ enum: ReconcileAction })
  @IsEnum(ReconcileAction)
  action!: ReconcileAction;

  @ApiPropertyOptional({ description: "For 'match': the live entity to match this row to." })
  @IsOptional()
  @IsUUID()
  matched_entity_id?: string;

  // Explicit free-form-object schema so swagger does NOT degrade `mapped_data` to `Record<string,never>`. — Batch A #2
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: "For 'edit': corrected mapped data (re-classified).",
  })
  @IsOptional()
  @IsObject()
  mapped_data?: Record<string, unknown>;
}

export class ReconcileDto {
  @ApiProperty({ type: [RowResolution] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RowResolution)
  resolutions!: RowResolution[];
}
