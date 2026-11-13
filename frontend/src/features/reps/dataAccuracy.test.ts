import { describe, expect, it } from 'vitest';
import { ACCURACY_ROWS, accuracyColumns, accuracySummary, type DataAccuracy } from './dataAccuracy';

const cell = (value: string | null, match: boolean | null = null) => ({ value, match });
const data = (differences: number, withSource = true): DataAccuracy => ({
  profile: { name: 'Riley Rivera', date_of_birth: '1994-03-21', address: '1 Main St, Winnipeg' },
  sources: withSource
    ? [
        {
          document_id: 'd1',
          doc_type: 'passport',
          name: cell('RIVERA RILEY', true),
          date_of_birth: cell('1995-03-21', false),
          document_number: cell('••••4567'),
          issued_on: cell('2022-06-30'),
          expires_on: cell('2032-06-30'),
          expired: false,
        },
      ]
    : [],
  differences,
});

describe('accuracyColumns (2026-11-13)', () => {
  it('puts the profile first and gives every column the same rows', () => {
    const cols = accuracyColumns(data(1));
    expect(cols.map((c) => c.title)).toEqual(['Rep profile', 'Passport']);
    for (const c of cols) expect(Object.keys(c.cells).sort()).toEqual(ACCURACY_ROWS.map((r) => r.key).sort());
    expect(cols[0].cells.document_number.notApplicable).toBe(true);
    expect(cols[1].cells.address.notApplicable).toBe(true);
    expect(cols[1].cells.date_of_birth.match).toBe(false);
  });

  it('summarises the differences', () => {
    expect(accuracySummary(data(0, false)).tone).toBe('info');
    expect(accuracySummary(data(0))).toEqual({ tone: 'success', title: 'Everything on file matches the profile' });
    expect(accuracySummary(data(2)).title).toBe('2 differences to check');
  });
});
