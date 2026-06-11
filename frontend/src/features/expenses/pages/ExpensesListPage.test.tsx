// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';

/**
 * Regression test for the production crash `(p.data ?? []).map is not a function` on /expenses. The expense
 * filter bar read /v1/reps as a plain array, but the endpoint returns the { data, meta } envelope. With the
 * `unwrapList` fix the page renders. /v1/pay-periods + /v1/expense-field-configs are genuinely plain arrays
 * (unwrapList returns them as-is) — the test also covers that mix.
 */

const h = vi.hoisted(() => {
  const meta = (n: number) => ({ total: n, page: 1, limit: 20, pageCount: n ? 1 : 0 });
  const env = (rows: unknown[]) => ({ data: rows, meta: meta(rows.length) });
  const state = { reps: env([{ id: 'r1', rep_code: 'RW-D-001', full_name: 'Rep One', status: 'active' }]) as unknown };
  function bodyFor(path: string): unknown {
    if (path === '/v1/reps') return state.reps;
    if (path === '/v1/clients') return env([{ id: 'c1', client_code: 'VF', name: 'Valley Fiber' }]);
    if (path === '/v1/expense-items') return env([]);
    if (path === '/v1/pay-periods') return []; // plain array (not paginated)
    if (path === '/v1/expense-field-configs') return []; // plain array
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

import ExpensesListPage from './ExpensesListPage';

afterEach(cleanup);
beforeEach(() => {
  h.state.reps = h.env([{ id: 'r1', rep_code: 'RW-D-001', full_name: 'Rep One', status: 'active' }]);
});

describe('ExpensesListPage — renders against the { data, meta } envelope (no .map crash)', () => {
  it('renders when /v1/reps returns a POPULATED { data, meta } envelope', async () => {
    const { client } = renderWithProviders(<ExpensesListPage />, { route: '/expenses' });
    await waitFor(() => expect(client.getQueryData(['reps', 'list'])).toBeDefined());
    expect(await screen.findByText('Expenses')).toBeTruthy();
  });

  it('renders when /v1/reps returns an EMPTY { data: [], meta } envelope', async () => {
    h.state.reps = h.env([]);
    const { client } = renderWithProviders(<ExpensesListPage />, { route: '/expenses' });
    await waitFor(() => expect(client.getQueryData(['reps', 'list'])).toBeDefined());
    expect(await screen.findByText('Expenses')).toBeTruthy();
  });
});
