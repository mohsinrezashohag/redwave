// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';

/**
 * Regression test for the production crash `(p.data ?? []).map is not a function` on /sales. The rep filter
 * read /v1/reps as a plain array, but the endpoint returns the { data, meta } pagination envelope. With the
 * `unwrapList` fix the page renders; with the old code the post-fetch re-render threw. We mock the api client
 * (so the REAL useReps/useClients/useServerTable run) and a permissive auth (so every dropdown renders).
 */

const h = vi.hoisted(() => {
  const meta = (n: number) => ({ total: n, page: 1, limit: 20, pageCount: n ? 1 : 0 });
  const env = (rows: unknown[]) => ({ data: rows, meta: meta(rows.length) });
  const state = { reps: env([{ id: 'r1', rep_code: 'RW-D-001', full_name: 'Rep One', status: 'active' }]) as unknown };
  function bodyFor(path: string): unknown {
    if (path === '/v1/reps') return state.reps;
    if (path === '/v1/clients') return env([{ id: 'c1', client_code: 'VF', name: 'Valley Fiber' }]);
    if (path === '/v1/sales') return env([]);
    return env([]);
  }
  return { meta, env, state, bodyFor };
});

vi.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'u1', email: 'sa@redwave.local', rep_id: null },
    roles: [],
    permissions: { has: () => true },
    isSuperAdmin: true,
    repId: null,
  }),
}));

vi.mock('../../../api/client', () => ({
  api: {
    GET: (path: string) => Promise.resolve({ data: h.bodyFor(path), error: undefined, response: { ok: true, status: 200 } }),
    POST: () => Promise.resolve({ data: {}, error: undefined, response: { ok: true, status: 200 } }),
  },
}));

import SalesListPage from './SalesListPage';

afterEach(cleanup);
beforeEach(() => {
  h.state.reps = h.env([{ id: 'r1', rep_code: 'RW-D-001', full_name: 'Rep One', status: 'active' }]);
});

describe('SalesListPage — renders against the { data, meta } envelope (no .map crash)', () => {
  it('renders when /v1/reps returns a POPULATED { data, meta } envelope', async () => {
    const { client } = renderWithProviders(<SalesListPage />, { route: '/sales' });
    // The crash was a post-fetch re-render; wait until the rep query settles, then assert the page is intact.
    await waitFor(() => expect(client.getQueryData(['reps', 'list'])).toBeDefined());
    expect(await screen.findByText('Sales')).toBeTruthy();
  });

  it('renders when /v1/reps returns an EMPTY { data: [], meta } envelope', async () => {
    h.state.reps = h.env([]);
    const { client } = renderWithProviders(<SalesListPage />, { route: '/sales' });
    await waitFor(() => expect(client.getQueryData(['reps', 'list'])).toBeDefined());
    expect(await screen.findByText('Sales')).toBeTruthy();
  });
});
