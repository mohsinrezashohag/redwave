import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { allCookieValues, setCsrfCookie, setRefreshCookie } from './cookie.util';

const config = (env: Record<string, string | undefined>): ConfigService =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

const mockRes = () => {
  const res = { cookie: jest.fn(), clearCookie: jest.fn() };
  return res as unknown as Response & { cookie: jest.Mock; clearCookie: jest.Mock };
};

describe('allCookieValues — EVERY value of a possibly-duplicated cookie (raw Cookie header)', () => {
  it('returns [] for a missing/empty header', () => {
    expect(allCookieValues(undefined, 'rw_csrf')).toEqual([]);
    expect(allCookieValues('', 'rw_csrf')).toEqual([]);
  });

  it('returns the single value, ignoring other cookies', () => {
    expect(allCookieValues('sid=1; rw_csrf=abc; theme=dark', 'rw_csrf')).toEqual(['abc']);
  });

  it('returns ALL values when the name is duplicated (host-only shadow + domain cookie)', () => {
    expect(allCookieValues('rw_csrf=stale; rw_csrf=fresh', 'rw_csrf')).toEqual(['stale', 'fresh']);
  });

  it('trims whitespace and percent-decodes values', () => {
    expect(allCookieValues('  rw_csrf=a%2Bb ; other=x', 'rw_csrf')).toEqual(['a+b']);
  });

  it('keeps a malformed-encoding value as-is instead of throwing', () => {
    expect(allCookieValues('rw_csrf=%E0%A4%A', 'rw_csrf')).toEqual(['%E0%A4%A']);
  });

  it('does not match a name prefix (rw_csrf_old ≠ rw_csrf)', () => {
    expect(allCookieValues('rw_csrf_old=zzz', 'rw_csrf')).toEqual([]);
  });
});

describe('cookie issue — heals a stale HOST-ONLY shadow before setting the domain-scoped cookie', () => {
  const prod = config({ NODE_ENV: 'production', COOKIE_DOMAIN: '.redwavemarketing.ca' });

  it('setCsrfCookie (prod+domain): clears the host-only variant FIRST, then sets the domain cookie', () => {
    const res = mockRes();
    setCsrfCookie(res, prod, 'tok', 1000);

    expect(res.clearCookie).toHaveBeenCalledWith(
      'rw_csrf',
      expect.objectContaining({ path: '/', httpOnly: false }),
    );
    // the CLEAR is host-only — it must NOT carry the domain (that would clear the cookie we're issuing)
    const clearOpts = res.clearCookie.mock.calls[0][1] as Record<string, unknown>;
    expect('domain' in clearOpts).toBe(false);

    expect(res.cookie).toHaveBeenCalledWith(
      'rw_csrf',
      'tok',
      expect.objectContaining({ domain: '.redwavemarketing.ca', httpOnly: false, secure: true, maxAge: 1000 }),
    );
    // order: heal before issue
    expect(res.clearCookie.mock.invocationCallOrder[0]).toBeLessThan(res.cookie.mock.invocationCallOrder[0]);
  });

  it('setRefreshCookie (prod+domain): clears the host-only variant with httpOnly true', () => {
    const res = mockRes();
    setRefreshCookie(res, prod, 'tok', 1000);
    expect(res.clearCookie).toHaveBeenCalledWith(
      'rw_refresh',
      expect.objectContaining({ path: '/', httpOnly: true }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'rw_refresh',
      'tok',
      expect.objectContaining({ domain: '.redwavemarketing.ca', httpOnly: true }),
    );
  });

  it('dev (no domain): sets host-only cookies and performs NO clear', () => {
    const res = mockRes();
    setCsrfCookie(res, config({ NODE_ENV: 'development', COOKIE_DOMAIN: '' }), 'tok', 1000);
    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalledWith('rw_csrf', 'tok', expect.objectContaining({ secure: false }));
  });

  it('prod WITHOUT COOKIE_DOMAIN: no clear (cookies are already host-only)', () => {
    const res = mockRes();
    setRefreshCookie(res, config({ NODE_ENV: 'production' }), 'tok', 1000);
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
});
