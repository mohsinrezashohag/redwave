/**
 * CsrfGuard — double-submit CSRF protection (runs after auth/permissions, globally).
 *
 * On a state-changing request (POST/PUT/PATCH/DELETE) it requires the `X-CSRF-Token` header to equal a
 * presented `rw_csrf` cookie. It SKIPS:
 *   • safe methods (GET/HEAD/OPTIONS),
 *   • `@CsrfExempt()` routes (login / forgot / reset / mfa-verify — they run before any CSRF cookie exists),
 *   • any request with no `rw_csrf` cookie at all (a pure Bearer/API client carries no ambient cookie, so
 *     it isn't CSRF-exposed; only cookie-bearing browser sessions are checked).
 *
 * DUPLICATE-COOKIE SAFE: the browser can hold MULTIPLE `rw_csrf` cookies (e.g. a stale host-only one from a
 * pre-COOKIE_DOMAIN deploy alongside the current domain-scoped one) and sends them all — the stale one first
 * (RFC 6265 §5.4). cookie-parser keeps only that first value, which silently 403'd every mutation in
 * production. The guard therefore checks the header against EVERY presented `rw_csrf` value (parsed from the
 * raw Cookie header). Security-equivalent: double-submit only requires the caller prove it can READ a cookie
 * the browser holds for this site — a cross-site attacker can read none of them. — arch §security (CSRF)
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { allCookieValues, CSRF_COOKIE, CSRF_HEADER } from './cookie.util';
import { CSRF_EXEMPT_KEY } from './csrf-exempt.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }
    const exempt = this.reflector.getAllAndOverride<boolean>(CSRF_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) {
      return true;
    }
    // EVERY presented rw_csrf value: the raw Cookie header (catches duplicates cookie-parser collapses)
    // unioned with req.cookies (compat for callers that only populate the parsed map).
    const candidates = new Set(allCookieValues(request.headers.cookie, CSRF_COOKIE));
    const parsed = (request.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
    if (parsed) {
      candidates.add(parsed);
    }
    if (candidates.size === 0) {
      // No CSRF cookie → not a cookie-authenticated browser session (Bearer/API or pre-login). Nothing to forge.
      return true;
    }
    const headerToken = request.headers[CSRF_HEADER];
    const header = Array.isArray(headerToken) ? headerToken[0] : headerToken;
    if (header && candidates.has(header)) {
      return true;
    }
    throw new ForbiddenException('CSRF token missing or invalid');
  }
}
