/**
 * Chatbot settings + status DTOs. The Super Admin toggles the AI model and picks its id; everyone can read
 * which mode the assistant is in (so the UI can drop the "basic assistant" banner). No secrets: the API key
 * lives only in the environment and is reported as configured / not configured. — SRS RPT-011
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateChatbotConfigDto {
  @ApiPropertyOptional({ description: 'Turn the AI model on or off.' })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ example: 'gemini-2.5-flash', description: 'Gemini model id.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, { message: 'model must be a model id like gemini-2.5-flash' })
  model?: string;
}

export class ChatbotStatusResponse {
  @ApiProperty({ enum: ['ai', 'basic'], description: 'ai = the language model answers; basic = the keyword assistant.' })
  mode!: 'ai' | 'basic';
}

export class ChatbotConfigResponse {
  @ApiProperty()
  is_active!: boolean;

  @ApiProperty({ example: 'gemini' })
  provider!: string;

  @ApiProperty({ example: 'gemini-2.5-flash' })
  model!: string;

  @ApiProperty({ description: 'Whether GEMINI_API_KEY is set on the server (the key itself is never returned).' })
  api_key_configured!: boolean;

  @ApiProperty({ enum: ['ai', 'basic'], description: 'The mode the assistant is in right now.' })
  mode!: 'ai' | 'basic';
}
