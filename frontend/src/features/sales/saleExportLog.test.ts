import { describe, expect, it } from 'vitest';
import { exportFilters, serverFormat } from './api/useSaleExports';
import { describeFilters } from './saleExportLog';
import { displayDateTime } from '../../lib/format/date';

describe('sales export log helpers', () => {
  it('records the browser’s xlsx as the server’s "excel"', () => {
    expect(serverFormat('xlsx')).toBe('excel');
    expect(serverFormat('csv')).toBe('csv');
  });

  it('sends only the filters that are actually set', () => {
    expect(exportFilters({ status: 'paid', client_id: undefined, search: '' })).toEqual({ status: 'paid' });
  });

  it('describes what narrowed an export in words; no filters = all sales', () => {
    expect(describeFilters({})).toBe('All sales');
    expect(describeFilters({ status: 'paid', date_from: '2026-11-01', client_id: 'c' })).toBe(
      'Status: paid · From 2026-11-01 · One client',
    );
  });

  it('shows export times in Winnipeg time (05:35 UTC on Nov 11 = 23:35 Nov 10)', () => {
    expect(displayDateTime('2026-11-11T05:35:00Z')).toMatch(/Nov 10, 2026|10 Nov 2026/);
    expect(displayDateTime('2026-11-11T05:35:00Z')).toContain('23:35');
    expect(displayDateTime(null)).toBe('');
  });
});
