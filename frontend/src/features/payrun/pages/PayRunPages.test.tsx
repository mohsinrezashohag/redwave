// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../../test/renderWithProviders';

/**
 * Commission reports (client decision 2026-11-16): the history names every report by the server's
 * `display_label`, the detail shows no clawback column, and "Mark as paid" needs the typed phrase.
 * The api client is mocked so the REAL hooks run; auth is permissive so every action renders.
 */
const h = vi.hoisted(() => {
  const meta = (n: number) => ({ total: n, page: 1, limit: 20, pageCount: n ? 1 : 0 });
  const env = (rows: unknown[]) => ({ data: rows, meta: meta(rows.length) });
  const summary = {
    id: 'run-1',
    kind: 'range',
    display_label: 'November first half',
    label: 'November first half',
    window_start: '2026-11-01',
    window_end: '2026-11-14',
    pay_period_id: null,
    pay_period: null,
    date_from: '2026-11-01T00:00:00.000Z',
    date_to: '2026-11-14T00:00:00.000Z',
    client_id: null,
    client: null,
    rep_id: null,
    scope_rep: null,
    run_date: '2026-11-16T00:00:00.000Z',
    status: 'draft',
    executed_by: 'u1',
    created_at: '2026-11-16T00:00:00.000Z',
  };
  const legacy = { ...summary, id: 'run-0', kind: 'period', display_label: 'Pay period #21', label: null, status: 'finalized' };
  const line = {
    id: 'line-1',
    pay_run_id: 'run-1',
    rep_id: 'r1',
    rep: { id: 'r1', rep_code: 'RW-0001', full_name: 'Rep One', photo_url: null },
    commission: '240.00',
    expense_total: '12.50',
    incentive_total: '0.00',
    bonus_amount: '0.00',
    bonus_note: null,
    clawback_total: '0.00',
    net_payout: '252.50',
  };
  const posts: string[] = [];
  function bodyFor(path: string): unknown {
    if (path === '/v1/pay-runs') return env([summary, legacy]);
    if (path === '/v1/pay-runs/{id}') return { ...summary, lines: [line] };
    return env([]);
  }
  return { bodyFor, posts };
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
    POST: (path: string) => {
      h.posts.push(path);
      return Promise.resolve({ data: { id: 'run-1', lines: [] }, error: undefined, response: { ok: true, status: 200 } });
    },
    DELETE: () => Promise.resolve({ data: { id: 'run-1', deleted: true }, error: undefined, response: { ok: true, status: 200 } }),
  },
}));

import PayRunListPage from './PayRunListPage';
import PayRunDetailPage from './PayRunDetailPage';

afterEach(cleanup);

describe('Commission reports list', () => {
  it('shows the New report form and names every report by display_label (legacy and range)', async () => {
    renderWithProviders(<PayRunListPage />, { route: '/pay-runs' });
    expect(await screen.findByText('Commission reports')).toBeTruthy();
    expect(screen.getByText('New report')).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate report/i })).toBeTruthy();
    expect(await screen.findByText('November first half')).toBeTruthy();
    expect(screen.getByText('Pay period #21')).toBeTruthy();
  });

  it('does not submit without both dates', async () => {
    renderWithProviders(<PayRunListPage />, { route: '/pay-runs' });
    fireEvent.click(await screen.findByRole('button', { name: /generate report/i }));
    expect(await screen.findByText('Choose a start date.')).toBeTruthy();
    expect(h.posts).not.toContain('/v1/pay-runs');
  });
});

describe('Commission report detail', () => {
  const renderDetail = () =>
    renderWithProviders(
      <Routes>
        <Route path="/pay-runs/:id" element={<PayRunDetailPage />} />
      </Routes>,
      { route: '/pay-runs/run-1' },
    );

  it('shows per-rep totals from the server and no clawback column', async () => {
    renderDetail();
    expect(await screen.findByText('Rep One')).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('$252.50')).toBeTruthy();
    expect(within(table).queryByText(/clawback/i)).toBeNull();
  });

  it('"Mark as paid" stays disabled until the phrase is typed', async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as paid' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/freezes the rates and cannot be undone/i)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Mark as paid' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByPlaceholderText('MARK PAID'), { target: { value: 'MARK PAID' } });
    expect(confirm.disabled).toBe(false);
  });
});
