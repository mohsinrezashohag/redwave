/**
 * `@ApiErrorResponses()` — documents the uniform error envelope (arch §5.1) on an endpoint's error
 * statuses. The global `AllExceptionsFilter` normalizes EVERY non-2xx response to
 * `{ error: { code, message, details? } }` (the `ErrorEnvelopeDto` shape), so we attach that schema to
 * the common client-fault statuses. Apply at the CONTROLLER-CLASS level — `@ApiResponse` cascades to
 * every route in the controller — so one line documents the whole controller's error contract. Per-route
 * success responses are still declared per method (`@ApiOkResponse`/`@ApiCreatedResponse`). — Batch A #2
 */
import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorEnvelopeDto } from './error-envelope.dto';

export function ApiErrorResponses(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    ApiResponse({ status: 400, type: ErrorEnvelopeDto, description: 'Bad Request — validation failed' }),
    ApiResponse({ status: 401, type: ErrorEnvelopeDto, description: 'Unauthorized — missing/invalid token' }),
    ApiResponse({ status: 403, type: ErrorEnvelopeDto, description: 'Forbidden — RBAC denied' }),
    ApiResponse({ status: 404, type: ErrorEnvelopeDto, description: 'Not Found' }),
    ApiResponse({ status: 409, type: ErrorEnvelopeDto, description: 'Conflict — invalid state transition' }),
    ApiResponse({ status: 422, type: ErrorEnvelopeDto, description: 'Unprocessable Entity — domain rule violated' }),
  );
}
