import { groupIssues, RowIssue, summariseIssues } from './group-issues.logic';

const row = (row_number: number, match_status: string, issue: string | null): RowIssue => ({ row_number, match_status, issue });

describe('groupIssues', () => {
  it('collapses one repeated problem into a single group (the real UAT file shape)', () => {
    // All 16 rows of `Sales Upload.xlsx` failed the same way before the vocabulary landed.
    const rows = Array.from({ length: 16 }, (_, i) => row(i + 1, 'error', 'unknown product type "Internet, TV" — did you mean internet + tv?'));
    const groups = groupIssues(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(16);
    expect(groups[0].sample_issue).toContain('did you mean internet + tv?');
  });

  it('caps the listed rows but keeps the true count', () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(i + 1, 'error', 'client_code is required'));
    const [group] = groupIssues(rows);
    expect(group.count).toBe(25);
    expect(group.row_numbers).toHaveLength(10);
    expect(group.row_numbers[0]).toBe(1);
  });

  it('groups issues that differ only in a quoted value or a code', () => {
    const groups = groupIssues([
      row(1, 'error', 'unknown product type "Internet, TV"'),
      row(2, 'error', 'unknown product type "Fibre Optic"'),
      row(3, 'error', 'rep RW-D-0001 not found'),
      row(4, 'error', 'rep RW-D-0002 not found'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.count === 2)).toBe(true);
  });

  it('keeps genuinely different problems apart, largest first', () => {
    const groups = groupIssues([
      row(1, 'error', 'client_code is required'),
      row(2, 'error', 'sale_date must be YYYY-MM-DD'),
      row(3, 'error', 'sale_date must be YYYY-MM-DD'),
      row(4, 'error', 'sale_date must be YYYY-MM-DD'),
    ]);
    expect(groups.map((g) => g.count)).toEqual([3, 1]);
    expect(groups[0].issue).toContain('sale_date');
  });

  it('separates the same text under different statuses', () => {
    const groups = groupIssues([row(1, 'error', 'no MPU ID'), row(2, 'unmatched', 'no MPU ID')]);
    expect(groups).toHaveLength(2);
  });

  it('ignores matched and ignored rows — they are not problems', () => {
    expect(groupIssues([row(1, 'matched', null), row(2, 'ignored', 'skipped by operator')])).toEqual([]);
  });

  it('falls back to the status when a row carries no issue text', () => {
    const [group] = groupIssues([row(1, 'duplicate', null)]);
    expect(group.issue).toBe('row is duplicate');
  });
});

describe('summariseIssues', () => {
  it('leads with the biggest blocker and counts the rest', () => {
    const groups = groupIssues([
      row(1, 'error', 'unknown product type "Internet, TV"'),
      row(2, 'error', 'unknown product type "Internet, TV"'),
      row(3, 'error', 'client_code is required'),
    ]);
    expect(summariseIssues(groups)).toBe('3 rows need attention — 2× unknown product type "Internet, TV" (+1 other issue)');
  });

  it('is null when nothing needs attention', () => {
    expect(summariseIssues([])).toBeNull();
  });
});
