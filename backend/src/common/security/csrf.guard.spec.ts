import { ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';

function ctx(req: { method: string; cookies?: Record<string, string>; headers?: Record<string, string> }, exempt = false) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(exempt) } as never;
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ headers: {}, ...req }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as never;
  return { guard: new CsrfGuard(reflector), context };
}

describe('CsrfGuard — double-submit on mutating cookie-session requests (arch §security)', () => {
  it('passes safe methods (GET/HEAD/OPTIONS) regardless of tokens', () => {
    const { guard, context } = ctx({ method: 'GET' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('passes a request with no rw_csrf cookie (Bearer/API or pre-login — nothing to forge)', () => {
    const { guard, context } = ctx({ method: 'POST', cookies: {}, headers: {} });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('REJECTS a mutating cookie-session request whose header is missing', () => {
    const { guard, context } = ctx({ method: 'POST', cookies: { rw_csrf: 'abc' }, headers: {} });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('REJECTS when the header does not match the cookie', () => {
    const { guard, context } = ctx({ method: 'POST', cookies: { rw_csrf: 'abc' }, headers: { 'x-csrf-token': 'WRONG' } });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('passes when the X-CSRF-Token header equals the rw_csrf cookie', () => {
    const { guard, context } = ctx({ method: 'POST', cookies: { rw_csrf: 'abc' }, headers: { 'x-csrf-token': 'abc' } });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('passes a @CsrfExempt route even with a mismatched cookie (login/forgot/reset/mfa-verify)', () => {
    const { guard, context } = ctx({ method: 'POST', cookies: { rw_csrf: 'abc' }, headers: {} }, true);
    expect(guard.canActivate(context)).toBe(true);
  });
});

describe('CsrfGuard — DUPLICATE rw_csrf cookies (a stale host-only shadow + the fresh domain cookie)', () => {
  // The production failure: a stale host-only rw_csrf (pre-COOKIE_DOMAIN deploy) sorts FIRST in the Cookie
  // header; cookie-parser keeps only it, so the old guard compared stale-vs-fresh and 403'd every mutation.

  it('passes when the header matches the SECOND (fresh domain) cookie — the production repro, fixed', () => {
    const { guard, context } = ctx({
      method: 'POST',
      cookies: { rw_csrf: 'stale' }, // what cookie-parser yields (first-wins)
      headers: { cookie: 'rw_csrf=stale; rw_csrf=fresh', 'x-csrf-token': 'fresh' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('passes when the header matches the FIRST cookie', () => {
    const { guard, context } = ctx({
      method: 'POST',
      cookies: { rw_csrf: 'stale' },
      headers: { cookie: 'rw_csrf=stale; rw_csrf=fresh', 'x-csrf-token': 'stale' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('REJECTS when the header matches NEITHER presented value', () => {
    const { guard, context } = ctx({
      method: 'POST',
      cookies: { rw_csrf: 'stale' },
      headers: { cookie: 'rw_csrf=stale; rw_csrf=fresh', 'x-csrf-token': 'forged' },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('passes on a raw-header-only request (no parsed req.cookies) when the header matches', () => {
    const { guard, context } = ctx({
      method: 'POST',
      headers: { cookie: 'other=1; rw_csrf=abc', 'x-csrf-token': 'abc' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('still REJECTS a single-cookie request whose header is missing (raw header present)', () => {
    const { guard, context } = ctx({
      method: 'POST',
      headers: { cookie: 'rw_csrf=abc' },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
