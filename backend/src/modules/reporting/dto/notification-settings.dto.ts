import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** One per-event setting (Super Admin only; NO per-user override): channel toggles + editable templates. — RPT-009/010 */
export class EventSettingInput {
  @ApiProperty({ example: 'rate_change' })
  @IsString()
  @MaxLength(60)
  event_type!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  in_app_enabled!: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  email_enabled!: boolean;

  @ApiPropertyOptional({ description: 'Display label for the catalogue.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ description: 'Title template with {var} placeholders (null → call-site title).' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title_template?: string;

  @ApiPropertyOptional({ description: 'Body template with {var} placeholders (null → call-site body).' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body_template?: string;
}

export class UpdateNotificationSettingsDto {
  @ApiProperty({ type: [EventSettingInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EventSettingInput)
  settings!: EventSettingInput[];
}
