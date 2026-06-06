/**
 * DomainError — a FRAMEWORK-FREE marker for a client-fault domain-rule violation (a 422). It deliberately
 * imports nothing from `@nestjs/common`, so pure/shared logic modules (which the frontend mirrors) can throw
 * it without taking on a Nest dependency. The global AllExceptionsFilter recognises it and maps it to HTTP
 * 422 with the contract envelope `{ error: { code, message, details } }`. — arch §5.1 / §11
 *
 * Contrast: a bare `Error` (or any other non-HttpException) is treated as an INTERNAL fault → masked 500.
 * Only throw a DomainError when the cause is the caller's input/state, not a server bug.
 */
export class DomainError extends Error {
  constructor(
    /** A stable machine code for the envelope (e.g. 'TIER_SCHEDULE_INVALID'). */
    public readonly code: string,
    message: string,
    /** Optional structured detail surfaced under `error.details`. */
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
