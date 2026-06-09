/**
 * Product-type catalogue response. behaviour is the LOCKED commission classification; is_system marks the
 * 4 core types (behaviour immutable, non-deletable, non-deactivatable). — §6
 */
import { ApiProperty } from '@nestjs/swagger';

export class ProductTypeResponse {
  @ApiProperty({ example: 'internet', description: 'Immutable catalogue key.' })
  key!: string;

  @ApiProperty({ example: 'Internet' })
  label!: string;

  @ApiProperty({ enum: ['tiered', 'greenfield', 'standard_addon'] })
  behaviour!: 'tiered' | 'greenfield' | 'standard_addon';

  @ApiProperty({ description: 'A core type — behaviour locked, cannot be deleted/deactivated.' })
  is_system!: boolean;

  @ApiProperty()
  is_active!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}
