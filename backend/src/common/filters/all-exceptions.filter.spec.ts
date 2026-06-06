import {
  BadRequestException,
  ConflictException,
  Logger,
  UnprocessableEntityException,
  type ArgumentsHost,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { DomainError } from '../errors/domain-error';

type Body = { error: { code: string; message: string; details?: Record<string, unknown> } };

function capture() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as unknown as ArgumentsHost;
  return { host, status, body: () => json.mock.calls[0][0] as Body };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('maps a DomainError → 422 envelope with its code + details', () => {
    const c = capture();
    filter.catch(new DomainError('TIER_SCHEDULE_INVALID', 'bad brackets', { gap: true }), c.host);
    expect(c.status).toHaveBeenCalledWith(422);
    expect(c.body()).toEqual({
      error: { code: 'TIER_SCHEDULE_INVALID', message: 'bad brackets', details: { gap: true } },
    });
  });

  it('normalizes an UnprocessableEntityException(string) → 422 envelope (status preserved)', () => {
    const c = capture();
    filter.catch(new UnprocessableEntityException('effective_from cannot be in the past'), c.host);
    expect(c.status).toHaveBeenCalledWith(422);
    expect(c.body().error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(c.body().error.message).toBe('effective_from cannot be in the past');
  });

  it('preserves a structured payload (unpriced) into details', () => {
    const c = capture();
    filter.catch(
      new UnprocessableEntityException({ message: 'cannot generate', unpriced: [{ product_name: 'Internet' }] }),
      c.host,
    );
    expect(c.status).toHaveBeenCalledWith(422);
    expect(c.body()).toEqual({
      error: {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'cannot generate',
        details: { unpriced: [{ product_name: 'Internet' }] },
      },
    });
  });

  it('folds a ValidationPipe message array into details.messages', () => {
    const c = capture();
    filter.catch(
      new BadRequestException({ statusCode: 400, message: ['a must be a string', 'b is required'], error: 'Bad Request' }),
      c.host,
    );
    expect(c.status).toHaveBeenCalledWith(400);
    expect(c.body()).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'a must be a string, b is required',
        details: { messages: ['a must be a string', 'b is required'] },
      },
    });
  });

  it('normalizes a ConflictException(string) → 409, status preserved', () => {
    const c = capture();
    filter.catch(new ConflictException('a clawback already exists for this item'), c.host);
    expect(c.status).toHaveBeenCalledWith(409);
    expect(c.body().error.code).toBe('CONFLICT');
    expect(c.body().error.message).toBe('a clawback already exists for this item');
  });

  it('masks a bare Error → 500 (generic message + correlationId) and logs the real error server-side', () => {
    const c = capture();
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter.catch(new Error('boom: secret internal detail'), c.host);

    expect(c.status).toHaveBeenCalledWith(500);
    const body = c.body();
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe('An unexpected error occurred.');
    expect(body.error.message).not.toContain('boom'); // internals never leak to the client
    const correlationId = String(body.error.details?.correlationId);
    expect(correlationId).toMatch(/[0-9a-f-]{36}/);

    expect(spy).toHaveBeenCalled();
    const logged = String(spy.mock.calls[0][0]);
    expect(logged).toContain('boom: secret internal detail'); // real error logged server-side
    expect(logged).toContain(correlationId);
    spy.mockRestore();
  });
});
