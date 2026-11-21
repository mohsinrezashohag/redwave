// @vitest-environment jsdom
/**
 * LeaderboardTable — approved and pending counts each get their own column (client meeting 2026-11-16) and
 * the table never renders money (CLAUDE §5). The props are unchanged so embedded dashboards keep working.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LeaderboardTable } from './LeaderboardTable';
import type { LeaderboardRow } from '../dashboards.types';

afterEach(cleanup);

const row = (over: Partial<LeaderboardRow>): LeaderboardRow => ({
  rank: 1,
  rep_id: 'r1',
  rep_code: 'RW-1',
  rep_name: 'Riley Rivera',
  photo_url: null,
  approved_count: 9,
  pending_count: 2,
  activation_count: 9,
  ...over,
});

describe('LeaderboardTable', () => {
  it('shows Approved and Pending columns with their counts, and no money', () => {
    const { container, getByText } = render(
      <LeaderboardTable rows={[row({}), row({ rank: 2, rep_id: 'r2', rep_name: 'Sam Lee', approved_count: 0, pending_count: 4, activation_count: 0 })]} />,
    );
    expect(getByText('Approved')).toBeTruthy();
    expect(getByText('Pending')).toBeTruthy();
    expect(container.querySelector('[aria-label="9 approved"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="2 pending"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="4 pending"]')).not.toBeNull(); // a pending-only rep is listed
    expect(container.textContent).not.toMatch(/\$/);
  });

  it('caps rows with maxRows (embedded dashboard usage)', () => {
    const rows = [row({}), row({ rank: 2, rep_id: 'r2' }), row({ rank: 3, rep_id: 'r3' })];
    const { container } = render(<LeaderboardTable rows={rows} maxRows={2} highlightRepId="r2" />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });
});
