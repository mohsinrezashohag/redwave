import { describe, expect, it } from 'vitest';
import { exportFilename } from './exportFilename';

describe('exportFilename — the one naming convention', () => {
  it('names a filtered export by source, period and generation date', () => {
    expect(
      exportFilename({ source: 'sales', period: { from: '2026-07-01', to: '2026-07-23' }, generatedOn: '2026-07-23' }),
    ).toBe('redwave-sales-2026-07-01_2026-07-23-20260723');
  });

  it('drops the period segment entirely when nothing is filtered', () => {
    expect(exportFilename({ source: 'clients', generatedOn: '2026-07-23' })).toBe('redwave-clients-20260723');
    expect(exportFilename({ source: 'clients', period: {}, generatedOn: '2026-07-23' })).toBe('redwave-clients-20260723');
  });

  it('keeps a half-open range readable (from only / to only)', () => {
    expect(exportFilename({ source: 'expenses', period: { from: '2026-07-01' }, generatedOn: '2026-07-23' })).toBe(
      'redwave-expenses-2026-07-01-20260723',
    );
    expect(exportFilename({ source: 'expenses', period: { to: '2026-07-23' }, generatedOn: '2026-07-23' })).toBe(
      'redwave-expenses-2026-07-23-20260723',
    );
  });

  it('slugs a source that carries spaces, case or punctuation — safe on every OS', () => {
    expect(exportFilename({ source: 'Report: Business Summary', generatedOn: '2026-07-23' })).toBe(
      'redwave-report-business-summary-20260723',
    );
    expect(exportFilename({ source: 'expenses-weekly', generatedOn: '2026-07-23' })).toBe(
      'redwave-expenses-weekly-20260723',
    );
    // No character that a filesystem or Content-Disposition header would choke on.
    expect(exportFilename({ source: 'a/b\\c*d?"e', generatedOn: '2026-07-23' })).toMatch(/^[a-z0-9_-]+$/);
  });

  it('is deterministic — the same parts always give the same name (no clock read)', () => {
    const parts = { source: 'sales', period: { from: '2026-07-01', to: '2026-07-23' }, generatedOn: '2026-07-23' };
    expect(exportFilename(parts)).toBe(exportFilename(parts));
  });

  it('two exports of the same list on different days do NOT collide', () => {
    const a = exportFilename({ source: 'sales', generatedOn: '2026-07-23' });
    const b = exportFilename({ source: 'sales', generatedOn: '2026-07-24' });
    expect(a).not.toBe(b);
  });
});
