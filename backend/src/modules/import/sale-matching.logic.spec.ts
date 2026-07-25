/**
 * No-MPU matching specs. The customer/address shapes are taken from Redwave's own working file
 * (`docs/uat/Client billing report.xlsx`), which carries no MPU ID column at all.
 *
 * The rule under test throughout: a fuzzy match must NEVER auto-validate a sale, because validating the
 * wrong sale pays the wrong rep.
 */
import { CandidateSale, matchReportRow, scoreCandidate, STRONG_MATCH } from './sale-matching.logic';

const sale = (over: Partial<CandidateSale> & { id: string; sale_code: string }): CandidateSale => ({
  customer_name: 'Mark Thibault',
  street: '23 Shoreline Dr',
  sale_date: '2026-07-13',
  activation_date: '2026-07-13',
  ...over,
});

const MARK = sale({ id: 's-mark', sale_code: 'VF-2026-07-13' });

describe('scoreCandidate', () => {
  it('scores an exact name + address agreement as strong', () => {
    const res = scoreCandidate({ customer_name: 'Mark Thibault', service_address: '23 Shoreline Dr', activation_date: null }, MARK);
    expect(res.score).toBeGreaterThanOrEqual(STRONG_MATCH);
    expect(res.reasons).toEqual(['customer name', 'address']);
  });

  it('tolerates the street-type drift real files have (Dr vs Drive)', () => {
    const res = scoreCandidate({ customer_name: 'Mark Thibault', service_address: '23 Shoreline Drive', activation_date: null }, MARK);
    expect(res.reasons).toContain('address');
  });

  it('tolerates an abbreviated first name', () => {
    const res = scoreCandidate({ customer_name: 'M. Thibault', service_address: '23 Shoreline Dr', activation_date: null }, MARK);
    expect(res.reasons).toContain('customer name (approx)');
    expect(res.score).toBeGreaterThanOrEqual(STRONG_MATCH);
  });

  it('a date agreement alone is never strong — many sales share a date', () => {
    const res = scoreCandidate({ customer_name: null, service_address: null, activation_date: '2026-07-13' }, MARK);
    expect(res.score).toBeLessThan(STRONG_MATCH);
  });

  // The spouse case: same surname, same address, a DIFFERENT sale. Scoring alone can't tell them apart,
  // so the ambiguity guard — not the score — must be what prevents a wrong auto-match.
  it('will not auto-match a same-surname, same-address pair', () => {
    const spouse = sale({ id: 's-spouse', sale_code: 'VF-2026-07-20', customer_name: 'Marie Thibault' });
    const res = matchReportRow({ customer_name: 'M. Thibault', service_address: '23 Shoreline Dr', activation_date: null }, [MARK, spouse]);
    expect(res.matchedSaleId).toBeUndefined();
    expect(res.candidates).toHaveLength(2);
  });

  it('an unrelated household scores nothing', () => {
    const res = scoreCandidate({ customer_name: 'Dana Cole', service_address: '9 Elm St', activation_date: null }, MARK);
    expect(res.score).toBe(0);
  });

  it('a different house number on the same street is not an address match', () => {
    const res = scoreCandidate({ customer_name: 'Dana Cole', service_address: '99 Shoreline Dr', activation_date: null }, MARK);
    expect(res.reasons).not.toContain('address');
  });
});

describe('matchReportRow', () => {
  it('auto-matches one unambiguous strong candidate', () => {
    const res = matchReportRow(
      { customer_name: 'Mark Thibault', service_address: '23 Shoreline Dr', activation_date: '2026-07-13' },
      [MARK, sale({ id: 's-other', sale_code: 'VF-2', customer_name: 'Dana Cole', street: '9 Elm St' })],
    );
    expect(res.matchedSaleId).toBe('s-mark');
    expect(res.issue).toBeNull();
  });

  // The reason auto-match requires a clear winner: two lookalike households must never be guessed between.
  it('refuses to choose between two equally strong candidates', () => {
    const twin = sale({ id: 's-twin', sale_code: 'VF-2026-07-14' });
    const res = matchReportRow({ customer_name: 'Mark Thibault', service_address: '23 Shoreline Dr', activation_date: null }, [MARK, twin]);
    expect(res.matchedSaleId).toBeUndefined();
    expect(res.issue).toContain('several sales match equally well');
    expect(res.candidates).toHaveLength(2);
  });

  it('does not auto-match on a weak signal, but offers the closest candidates', () => {
    const res = matchReportRow({ customer_name: 'Mark Thibault', service_address: null, activation_date: null }, [MARK]);
    expect(res.matchedSaleId).toBeUndefined();
    expect(res.issue).toContain('no confident match');
    expect(res.issue).toContain('VF-2026-07-13'); // the candidate is named, so the operator can act
  });

  it('reports plainly when nothing resembles the row', () => {
    const res = matchReportRow({ customer_name: 'Nobody Here', service_address: '1 Nowhere Rd', activation_date: null }, [MARK]);
    expect(res.matchedSaleId).toBeUndefined();
    expect(res.candidates).toEqual([]);
    expect(res.issue).toContain('match manually');
  });

  it('handles an empty sale list', () => {
    const res = matchReportRow({ customer_name: 'Mark Thibault', service_address: '23 Shoreline Dr', activation_date: null }, []);
    expect(res.matchedSaleId).toBeUndefined();
    expect(res.candidates).toEqual([]);
  });

  it('a row with no identifying information at all matches nothing', () => {
    const res = matchReportRow({ customer_name: null, service_address: null, activation_date: null }, [MARK]);
    expect(res.matchedSaleId).toBeUndefined();
    expect(res.candidates).toEqual([]);
  });

  it('is deterministic — equal scores break on sale_code, not array order', () => {
    const twin = sale({ id: 's-twin', sale_code: 'VF-0001' });
    const forward = matchReportRow({ customer_name: 'Mark Thibault', service_address: '23 Shoreline Dr', activation_date: null }, [MARK, twin]);
    const reversed = matchReportRow({ customer_name: 'Mark Thibault', service_address: '23 Shoreline Dr', activation_date: null }, [twin, MARK]);
    expect(forward.candidates.map((c) => c.sale.id)).toEqual(reversed.candidates.map((c) => c.sale.id));
  });
});
