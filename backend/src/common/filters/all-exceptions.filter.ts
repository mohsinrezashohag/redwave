/**
 * AllExceptionsFilter — the single global exception filter. It normalises EVERY non-2xx response to the
 * contract envelope `{ error: { code, message, details } }` (arch §5.1) and enforces §11 ("no leaking of
 * internals; 4xx for client faults, 5xx logged with correlation IDs"):
 *
 *  • HttpException  → its own status is PRESERVED; the Nest body ({ statusCode, message, error } | a custom
 *                     payload | a ValidationPipe `message: string[]`) is folded into the envelope, keeping any
 *                     structured payload (e.g. billing's `unpriced`) under `details`.
 *  • DomainError    → 422 with its `code`/`message`/`details` (a framework-free client-fault marker).
 *  • anything else  → a MASKED 500: a generic message + a correlation id; the real error + stack are logged
 *                     SERVER-SIDE only. This is why bare Errors (the engine's internal invariants, Prisma
 *                     failures, genuine bugs) stay 500s and are never mistaken for client faults.
 *
 * Registered as an APP_FILTER in AppModule (mirrors the APP_GUARD pattern in AuthModule).
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { DomainError } from '../errors/domain-error';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  500: 'INTERNAL',
  503: 'SERVICE_UNAVAILABLE', // file storage not configured (the /v1/files fail-safe)
};

interface Envelope {
  error: { code: string; message: string; details?: unknown };
}

const RESERVED = new Set(['message', 'statusCode', 'error']);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toEnvelope(exception);
    res.status(status).json(body);
  }

  private toEnvelope(exception: unknown): { status: number; body: Envelope } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_STATUS[status] ?? 'ERROR';
      const r = exception.getResponse();
      if (typeof r === 'string') {
        return { status, body: { error: { code, message: r } } };
      }
      const obj = (r ?? {}) as Record<string, unknown>;
      const rawMessage = obj.message;
      const message = Array.isArray(rawMessage)
        ? rawMessage.join(', ')
        : String(rawMessage ?? exception.message);
      const details = this.detailsFrom(obj, Array.isArray(rawMessage) ? rawMessage : undefined);
      return { status, body: { error: { code, message, details } } };
    }

    if (exception instanceof DomainError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        body: { error: { code: exception.code, message: exception.message, details: exception.details } },
      };
    }

    // Anything else is an INTERNAL fault — log it (server-side only) and mask the response. — arch §11
    const correlationId = randomUUID();
    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`[${correlationId}] ${err.message}`, err.stack);
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL', message: 'An unexpected error occurred.', details: { correlationId } } },
    };
  }

  /** Everything on an HttpException's object response except the reserved keys, plus the raw validation list. */
  private detailsFrom(obj: Record<string, unknown>, messages?: unknown[]): Record<string, unknown> | undefined {
    const details: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!RESERVED.has(k)) details[k] = v;
    }
    if (messages) details.messages = messages;
    return Object.keys(details).length > 0 ? details : undefined;
  }
}
