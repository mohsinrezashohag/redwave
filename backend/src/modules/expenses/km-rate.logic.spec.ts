import { selectKmRate, type KmRateRow } from './km-rate.logic';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const row = (id: string, client_id: string | null, rate: string, from: string, to: string | null): KmRateRow => ({
  id,
  client_id,
  rate_per_km: rate,
  effective_from: d(from),
  effective_to: to ? d(to) : null,
});

describe('selectKmRate — per-client, effective-dated rep rate resolution (EXP-004)', () => {
  const rows: KmRateRow[] = [
    row('g1', null, '0.450', '2026-01-01', null), // global current
    row('c1', 'client-A', '0.500', '2026-01-01', null), // client-A current
    row('c2', 'client-A', '0.520', '2026-06-01', null), // client-A future (would bound c1 in practice)
  ];

  it('prefers the client-specific rate over the global rate', () => {
    expect(selectKmRate(rows, 'client-A', d('2026-03-10'))).toBe('0.500');
  });

  it('falls back to the GLOBAL rate when the client has no row', () => {
    expect(selectKmRate(rows, 'client-B', d('2026-03-10'))).toBe('0.450');
  });

  it('falls back to the global rate when clientId is null', () => {
    expect(selectKmRate(rows, null, d('2026-03-10'))).toBe('0.450');
  });

  it('picks the row in force on the date (latest effective_from ≤ date)', () => {
    // On/after 2026-06-01 the client-A future row is the one in force.
    expect(selectKmRate(rows, 'client-A', d('2026-07-01'))).toBe('0.520');
  });

  it('returns null (→ caller uses the default) when no scope has a row', () => {
    expect(selectKmRate([], 'client-A', d('2026-03-10'))).toBeNull();
    // A client row that has not started yet + no global → null.
    const future = [row('c9', 'client-A', '0.600', '2027-01-01', null)];
    expect(selectKmRate(future, 'client-A', d('2026-03-10'))).toBeNull();
  });
});
