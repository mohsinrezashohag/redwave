import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** A natural-language question to the read-only chatbot. — SRS RPT-011 */
export class ChatbotQueryDto {
  @ApiProperty({ example: 'How many sales do I have this period?' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  prompt!: string;

  @ApiPropertyOptional({ description: 'Continue this conversation (yours only); omit to start a new one.' })
  @IsOptional()
  @IsUUID()
  conversation_id?: string;
}
