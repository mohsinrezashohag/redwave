/**
 * ErrorEnvelopeDto — the contract's uniform error shape `{ error: { code, message, details? } }` (arch §5.1).
 * Registered as an OpenAPI extra model (main.ts + scripts/export-openapi.ts) so the envelope is documented in
 * `components.schemas` for client generators. The AllExceptionsFilter emits exactly this shape for every
 * non-2xx response. (Per-endpoint `@ApiResponse` wiring is a deferred follow-up — responses are `never`-typed.)
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ErrorBodyDto {
  @ApiProperty({ example: 'UNPROCESSABLE_ENTITY', description: 'Stable machine code for the error.' })
  code!: string;

  @ApiProperty({ example: 'tier brackets must be contiguous (each min_count = previous max_count + 1)' })
  message!: string;

  @ApiPropertyOptional({
    description: 'Optional structured detail (e.g. validation messages, an unpriced-products list).',
    type: 'object',
    additionalProperties: true,
  })
  details?: Record<string, unknown>;
}

export class ErrorEnvelopeDto {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}
