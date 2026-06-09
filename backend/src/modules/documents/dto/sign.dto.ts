import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export enum SignDecision {
  sign = 'sign',
  decline = 'decline',
}

/** A value the signer types into one of their text fields. */
export class SignFieldValue {
  @ApiProperty({ description: 'The signature_field id (must belong to the signer).' })
  @IsUUID('4')
  field_id!: string;

  @ApiProperty({ example: 'Jane Q. Doe' })
  @IsString()
  @MaxLength(200)
  text!: string;
}

/**
 * A recipient signs or declines their signature on a request. — SRS DOC-003/004
 * On signing, the server stamps the signer's assigned fields into a distinct per-signer copy (the
 * original is never mutated). A signature image is applied either from a saved signature (`signature_id`)
 * or an inline data-URL PNG (`signature_image`, e.g. drawn/typed in the moment). Text fields take
 * `field_values`; date fields are auto-filled with the signing date. No fields → a simple click-to-sign.
 */
export class SignDto {
  @ApiProperty({ enum: SignDecision })
  @IsEnum(SignDecision)
  decision!: SignDecision;

  @ApiPropertyOptional({ example: 'drawn', description: 'How signed: drawn / typed / saved / uploaded.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  method?: string;

  @ApiPropertyOptional({ description: 'Apply a saved signature (one of the caller’s own).' })
  @IsOptional()
  @IsUUID('4')
  signature_id?: string;

  @ApiPropertyOptional({ description: 'OR an inline data-URL PNG to apply (drawn/typed in the moment).' })
  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  signature_image?: string;

  @ApiPropertyOptional({ type: [SignFieldValue], description: 'Values for the signer’s text fields.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SignFieldValue)
  field_values?: SignFieldValue[];
}
