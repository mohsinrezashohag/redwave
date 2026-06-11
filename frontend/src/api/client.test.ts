import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for the CSRF double-submit attach: a MUTATION through the shared typed client must
 * carry the `X-CSRF-Token` header read LIVE from the `rw_csrf` cookie, plus credentials (so the cookie
 * itself rides cross-subdomain). The client module is imported DYNAMICALLY after the stubs because
 * openapi-fetch resolves its fetch/baseUrl when the client is created (module init).
 */

// Mutable document stub — the middleware reads document.cookie at REQUEST time, so tests vary it per call.
const doc = { cookie: 'rw_csrf=tok-123' };
vi.stubGlobal('document', doc);
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
// A baseUrl is required in node (a relative URL can't construct a Request); any absolute origin works.
vi.stubEnv('VITE_API_BASE_URL', 'https://api.test');

const okJson = () =>
  new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function loadClient() {
  return (await import('./client')).api;
}

beforeEach(() => {
  fetchMock.mockReset();
  // a FRESH Response per call — a Response body is single-read, and one test makes two requests
  fetchMock.mockImplementation(() => Promise.resolve(okJson()));
  doc.cookie = 'rw_csrf=tok-123';
});

describe('shared API client — double-submit CSRF header on mutations', () => {
  it('POST carries X-CSRF-Token equal to the rw_csrf cookie + credentials include', async () => {
    const api = await loadClient();
    await api.POST('/v1/notifications/mark-all-read');

    const req = fetchMock.mock.calls[0][0] as Request;
    expect(req.method).toBe('POST');
    expect(req.headers.get('x-csrf-token')).toBe('tok-123'); // header names are case-insensitive
    expect(req.credentials).toBe('include'); // the rw_csrf/rw_refresh cookies ride cross-subdomain
  });

  it('PATCH carries the header too (every mutating verb goes through the same middleware)', async () => {
    const api = await loadClient();
    await api.PATCH('/v1/notifications/{id}', { params: { path: { id: 'n1' } }, body: { is_read: true } });

    const req = fetchMock.mock.calls[0][0] as Request;
    expect(req.method).toBe('PATCH');
    expect(req.headers.get('x-csrf-token')).toBe('tok-123');
  });

  it('reads the cookie LIVE per request (a rotated rw_csrf is picked up immediately)', async () => {
    const api = await loadClient();
    await api.POST('/v1/notifications/mark-all-read');
    doc.cookie = 'rw_csrf=rotated-456'; // the server rotated the cookie (e.g. on refresh)
    await api.POST('/v1/notifications/mark-all-read');

    expect((fetchMock.mock.calls[0][0] as Request).headers.get('x-csrf-token')).toBe('tok-123');
    expect((fetchMock.mock.calls[1][0] as Request).headers.get('x-csrf-token')).toBe('rotated-456');
  });

  it('sends NO CSRF header when no rw_csrf cookie exists (pre-login; the server skips those)', async () => {
    const api = await loadClient();
    doc.cookie = '';
    await api.POST('/v1/notifications/mark-all-read');

    expect((fetchMock.mock.calls[0][0] as Request).headers.get('x-csrf-token')).toBeNull();
  });
});
