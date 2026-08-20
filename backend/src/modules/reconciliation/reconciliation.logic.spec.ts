import { tieOutExpenseDoc, tieOutPayRunLine, tieOutStatement } from './reconciliation.logic';

describe('tieOutStatement — billing tie-out (SRS §12)', () => {
  it('ties out when total = Σ lines = live re-price', () => {
    const r = tieOutStatement({ frozenTotal: '140.00', lineTotals: ['50.00', '90.00'], liveTotal: '140.00' });
    expect(r.ok).toBe(true);
    expect(r.discrepancies).toEqual([]);
    expect(r.lines_sum).toBe('140.00');
  });

  it('flags a stale statement (live re-price drifted from the frozen total)', () => {
    const r = tieOutStatement({ frozenTotal: '140.00', lineTotals: ['50.00', '90.00'], liveTotal: '160.00' });
    expect(r.ok).toBe(false);
    expect(r.statement_matches_live).toBe(false);
    expect(r.discrepancies.join(' ')).toMatch(/stale/i);
  });

  it('flags total ≠ sum of lines', () => {
    const r = tieOutStatement({ frozenTotal: '999.00', lineTotals: ['50.00', '90.00'], liveTotal: '140.00' });
    expect(r.ok).toBe(false);
    expect(r.total_equals_lines).toBe(false);
  });

  it('flags an un-repriceable period (null live total)', () => {
    const r = tieOutStatement({ frozenTotal: '140.00', lineTotals: ['140.00'], liveTotal: null });
    expect(r.ok).toBe(false);
    expect(r.live_total).toBeNull();
    expect(r.discrepancies.join(' ')).toMatch(/billing rate/i);
  });
});

describe('tieOutPayRunLine — pay-run tie-out (SRS §9)', () => {
  const line = (over: Partial<Record<string, string>> = {}) => ({
    rep_id: 'rep-1',
    rep_code: 'RW-D-001',
    commission_70: '2317.00',
    holdback_release_30: '0.00',
    expense_total: '0.00',
    incentive_total: '0.00',
    bonus_amount: '0.00',
    clawback_total: '0.00',
    net_payout: '2317.00',
    ...over,
  });

  it('ties out when net = advance + released + expense + incentive + bonus − clawback', () => {
    const r = tieOutPayRunLine(line({ holdback_release_30: '993.00', clawback_total: '100.00', net_payout: '3210.00' }));
    expect(r.recomputed_net).toBe('3210.00'); // 2317 + 993 − 100
    expect(r.ok).toBe(true);
  });

  it('flags a line whose stored net does not match its components', () => {
    const r = tieOutPayRunLine(line({ net_payout: '9999.00' }));
    expect(r.ok).toBe(false);
    expect(r.recomputed_net).toBe('2317.00');
    expect(r.stored_net).toBe('9999.00');
  });
});

/**
 * The client EXPENSE document tie-out (CEXP-) — reimbursable rep expenses billed on to the client. Kept a
 * separate check from the statement tie-out on purpose: a different stream, its own selection, its own
 * number sequence. Folding them together would invite one to be re-priced with the other's rules.
 */
describe('tieOutExpenseDoc', () => {
  const args = (over: Partial<Parameters<typeof tieOutExpenseDoc>[0]> = {}) => ({
    documentNumber: 12,
    frozenTotal: '450.00',
    lineAmounts: ['200.00', '150.00', '100.00'],
    liveTotal: '450.00',
    ...over,
  });

  it('passes when the frozen total equals both its lines and the live re-derive', () => {
    const tie = tieOutExpenseDoc(args());
    expect(tie.ok).toBe(true);
    expect(tie.total_equals_lines).toBe(true);
    expect(tie.document_matches_live).toBe(true);
    expect(tie.discrepancies).toEqual([]);
    expect(tie.document_number).toBe(12);
  });

  it('flags a total that does not equal the sum of its own frozen lines', () => {
    const tie = tieOutExpenseDoc(args({ frozenTotal: '460.00' }));
    expect(tie.ok).toBe(false);
    expect(tie.total_equals_lines).toBe(false);
    expect(tie.discrepancies[0]).toContain('does not equal the sum of its lines');
  });

  // The document is immutable by design, so drift means it is STALE — re-issue, never edit.
  it('flags a stale document when the live re-derive has moved', () => {
    const tie = tieOutExpenseDoc(args({ liveTotal: '505.00' }));
    expect(tie.ok).toBe(false);
    expect(tie.total_equals_lines).toBe(true);
    expect(tie.document_matches_live).toBe(false);
    expect(tie.discrepancies[0]).toContain('re-issue');
  });

  // Never silently treat "could not check" as "checked and fine".
  it('reports an un-derivable live total as a discrepancy, not a match', () => {
    const tie = tieOutExpenseDoc(args({ liveTotal: null }));
    expect(tie.ok).toBe(false);
    expect(tie.document_matches_live).toBe(false);
    expect(tie.live_total).toBeNull();
    expect(tie.discrepancies[0]).toContain('km rate');
  });

  it('compares at the 2-dp money policy, not by float', () => {
    const tie = tieOutExpenseDoc(args({ frozenTotal: '450.000', lineAmounts: ['200.001', '149.999', '100.00'] }));
    expect(tie.frozen_total).toBe('450.00');
    expect(tie.lines_sum).toBe('450.00');
    expect(tie.ok).toBe(true);
  });

  it('an empty document ties out at zero rather than erroring', () => {
    const tie = tieOutExpenseDoc(args({ frozenTotal: '0.00', lineAmounts: [], liveTotal: '0.00' }));
    expect(tie.lines_sum).toBe('0.00');
    expect(tie.ok).toBe(true);
  });
});
