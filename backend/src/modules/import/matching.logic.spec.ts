import {
  classifyBillingRateRow,
  classifyClientRow,
  classifyHistoricalSaleRow,
  classifyLiveSaleRow,
  splitProductTypes,
  classifyHoldbackRow,
  classifyProductRow,
  classifyRepRow,
  classifySalesRow,
} from './matching.logic';

describe('classifySalesRow (bulk validation — SALE-007/IMP-010)', () => {
  it('exactly one entered match → matched + matched_entity_id', () => {
    const c = classifySalesRow({ mpu_id: 'X9' }, { matchedSaleIds: ['sale-1'] });
    expect(c.match_status).toBe('matched');
    expect(c.matched_entity_id).toBe('sale-1');
  });
  it('multiple entered matches → duplicate', () => {
    expect(classifySalesRow({ mpu_id: 'X9' }, { matchedSaleIds: ['a', 'b'] }).match_status).toBe('duplicate');
  });
  it('no match with an MPU → unmatched', () => {
    expect(classifySalesRow({ mpu_id: 'X9' }, { matchedSaleIds: [] }).match_status).toBe('unmatched');
  });
  it('no MPU at all → unmatched (manual match required)', () => {
    const c = classifySalesRow({}, { matchedSaleIds: [] });
    expect(c.match_status).toBe('unmatched');
    expect(c.issue).toMatch(/manual match/);
  });
});

describe('classifyBillingRateRow (back-dated rates by code — #10)', () => {
  const good = { client_code: 'VF', product_name: 'Internet', rate_kind: 'product', amount: '60.00', effective_from: '2025-01-01' };
  const ctx = { clientExists: true, productExists: true };
  it('valid shape + existence → matched', () => {
    expect(classifyBillingRateRow(good, ctx).match_status).toBe('matched');
  });
  it("rate_kind 'product' without product_name → error", () => {
    expect(classifyBillingRateRow({ ...good, product_name: '' }, ctx).match_status).toBe('error');
  });
  it('non-decimal amount → error', () => {
    expect(classifyBillingRateRow({ ...good, amount: '6o' }, ctx).match_status).toBe('error');
  });
  it('client not found → error', () => {
    expect(classifyBillingRateRow(good, { ...ctx, clientExists: false }).match_status).toBe('error');
  });
});

describe('classifyClientRow / classifyProductRow / classifyRepRow', () => {
  it('client: needs code/name/market∈{CA,US}', () => {
    expect(classifyClientRow({ client_code: 'VF', name: 'Valley Fiber', market: 'CA' }, { existingClientId: null }).match_status).toBe('matched');
    expect(classifyClientRow({ client_code: 'VF', name: 'x', market: 'XX' }, { existingClientId: null }).match_status).toBe('error');
    // existing code → matched WITH the existing id (upsert/update)
    expect(classifyClientRow({ client_code: 'VF', name: 'x', market: 'CA' }, { existingClientId: 'c1' }).matched_entity_id).toBe('c1');
  });
  it('product: needs client + a catalogue product_type', () => {
    const row = { client_code: 'VF', name: 'Internet 1Gb', product_type: 'internet' };
    expect(classifyProductRow(row, { clientExists: true, productTypeExists: true }).match_status).toBe('matched');
    expect(classifyProductRow(row, { clientExists: false, productTypeExists: true }).match_status).toBe('error');
    expect(classifyProductRow(row, { clientExists: true, productTypeExists: false }).match_status).toBe('error');
  });
  it('rep: rep_code never reused (#11)', () => {
    const row = { rep_code: 'RW-D-0009', full_name: 'New Rep', hire_date: '2026-01-01' };
    expect(classifyRepRow(row, { codeExists: false }).match_status).toBe('matched');
    expect(classifyRepRow(row, { codeExists: true }).match_status).toBe('error'); // reuse rejected
  });
});

describe('classifyHistoricalSaleRow (reference-only)', () => {
  // `product_types` arrives already resolved by the service's value vocabulary, so the classifier sees
  // canonical keys and is told what failed to resolve.
  const good = { client_code: 'VF', rep_code: 'RW-D-0001', product_types: 'internet', sale_date: '2025-03-12', billed_amount: '60.00' };
  const ctx = {
    clientExists: true,
    repExists: true,
    unknownProductTypes: [] as string[],
    missingProductTypes: [] as string[],
    resolvedCount: 1,
    suggestion: 'internet' as string | null,
  };
  it('valid + existing client/rep/product → matched', () => {
    expect(classifyHistoricalSaleRow(good, ctx).match_status).toBe('matched');
  });
  it('no product for the client+type → error (import products first)', () => {
    const res = classifyHistoricalSaleRow(good, { ...ctx, missingProductTypes: ['internet'] });
    expect(res.match_status).toBe('error');
    expect(res.issue).toContain('import products first');
  });
  it('bad billed_amount → error', () => {
    expect(classifyHistoricalSaleRow({ ...good, billed_amount: 'x' }, ctx).match_status).toBe('error');
  });

  // ONE ROW = ONE HOUSEHOLD — the shape the real UAT file uses.
  it('accepts several resolved types on one row', () => {
    const row = { ...good, product_types: 'internet,tv,home_phone' };
    expect(classifyHistoricalSaleRow(row, { ...ctx, resolvedCount: 3 }).match_status).toBe('matched');
  });
  it('does NOT require an internet base — history may record a TV-only household (SALE-001a is entry-only)', () => {
    const row = { ...good, product_types: 'tv' };
    expect(classifyHistoricalSaleRow(row, ctx).match_status).toBe('matched');
  });
  it('an unresolvable type names the FIX, not a missing product', () => {
    const row = { ...good, product_types: 'Fibre Optic' };
    const res = classifyHistoricalSaleRow(row, { ...ctx, unknownProductTypes: ['Fibre Optic'], resolvedCount: 0, suggestion: null });
    expect(res.match_status).toBe('error');
    expect(res.issue).toContain('unknown product type');
    expect(res.issue).not.toContain('import products first');
  });
  // ── create_missing: opt-in auto-creation of referenced master data (migration only) ──
  describe('create_missing', () => {
    it('OFF by default — a missing client/rep/product is still an error', () => {
      expect(classifyHistoricalSaleRow(good, { ...ctx, clientExists: false }).match_status).toBe('error');
      expect(classifyHistoricalSaleRow(good, { ...ctx, repExists: false }).match_status).toBe('error');
      expect(classifyHistoricalSaleRow(good, { ...ctx, missingProductTypes: ['internet'] }).match_status).toBe('error');
    });

    it('ON — the row matches and says what it will bring into existence', () => {
      const res = classifyHistoricalSaleRow(good, { ...ctx, clientExists: false, repExists: false, createMissing: true });
      expect(res.match_status).toBe('matched');
      expect(res.issue).toBe('will create client VF, rep RW-D-0001');
    });

    it('ON — a missing product is named by type', () => {
      const res = classifyHistoricalSaleRow(good, { ...ctx, missingProductTypes: ['tv', 'home_phone'], createMissing: true });
      expect(res.issue).toBe('will create tv, home_phone products');
    });

    it('a clean row carries NO note even with the flag on', () => {
      expect(classifyHistoricalSaleRow(good, { ...ctx, createMissing: true }).issue).toBeNull();
    });

    // The product-type catalogue is Super-Admin-governed config (#10) — a file may never extend it.
    it('does NOT let an unknown product TYPE through, flag or no flag', () => {
      const row = { ...good, product_types: 'Fibre Optic' };
      const res = classifyHistoricalSaleRow(row, { ...ctx, unknownProductTypes: ['Fibre Optic'], resolvedCount: 0, suggestion: null, createMissing: true });
      expect(res.match_status).toBe('error');
      expect(res.issue).toContain('unknown product type');
    });

    it('still enforces the row-shape rules (a bad date is not creatable data)', () => {
      const row = { ...good, sale_date: 'nonsense' };
      expect(classifyHistoricalSaleRow(row, { ...ctx, createMissing: true }).match_status).toBe('error');
    });
  });

  it('a partially resolvable cell suggests the canonical form', () => {
    const row = { ...good, product_types: 'Internet, Fibre Optic' };
    const res = classifyHistoricalSaleRow(row, { ...ctx, unknownProductTypes: ['Fibre Optic'], suggestion: 'internet' });
    expect(res.issue).toContain('did you mean internet?');
  });
});

describe('classifyLiveSaleRow (LIVE sales — IMP-013)', () => {
  const good = {
    client_code: 'VF',
    rep_code: 'RW-D-0001',
    product_types: 'internet,tv',
    sale_date: '2026-07-06',
    customer_name: 'Jane Doe',
  };
  const ctx = { clientExists: true, repActive: true, missingProductTypes: [], hasInternetBase: true };

  it('valid + existing client/active rep/products + internet base → matched', () => {
    expect(classifyLiveSaleRow(good, ctx).match_status).toBe('matched');
  });
  it('defaults status to entered when the column is blank', () => {
    expect(classifyLiveSaleRow({ ...good, status: '' }, ctx).match_status).toBe('matched');
    expect(classifyLiveSaleRow({ ...good, status: 'validated' }, ctx).match_status).toBe('matched');
  });
  it('an unknown status → error', () => {
    const c = classifyLiveSaleRow({ ...good, status: 'paid' }, ctx);
    expect(c.match_status).toBe('error');
    expect(c.issue).toMatch(/entered or validated/);
  });

  // Unresolvable references must ERROR — an import never creates master data.
  it('unknown client → error (never creates the client)', () => {
    const c = classifyLiveSaleRow(good, { ...ctx, clientExists: false });
    expect(c.match_status).toBe('error');
    expect(c.issue).toContain('client VF not found');
  });
  it('unknown or INACTIVE rep → error (never creates the rep)', () => {
    const c = classifyLiveSaleRow(good, { ...ctx, repActive: false });
    expect(c.match_status).toBe('error');
    expect(c.issue).toMatch(/not found or not active/);
  });
  it('a product type with no active product for the client → error (import products first)', () => {
    const c = classifyLiveSaleRow(good, { ...ctx, missingProductTypes: ['tv'] });
    expect(c.match_status).toBe('error');
    expect(c.issue).toContain('tv');
  });

  // SALE-001a is pre-checked here so the gate blocks the row instead of a mid-commit rollback.
  it('add-ons only (no internet base) → error, not a mid-commit throw', () => {
    const c = classifyLiveSaleRow({ ...good, product_types: 'tv,home_phone' }, { ...ctx, hasInternetBase: false });
    expect(c.match_status).toBe('error');
    expect(c.issue).toMatch(/mandatory base/);
  });

  it('missing required columns → error', () => {
    expect(classifyLiveSaleRow({ ...good, client_code: '' }, ctx).match_status).toBe('error');
    expect(classifyLiveSaleRow({ ...good, rep_code: '' }, ctx).match_status).toBe('error');
    expect(classifyLiveSaleRow({ ...good, product_types: '' }, ctx).match_status).toBe('error');
    expect(classifyLiveSaleRow({ ...good, customer_name: '' }, ctx).match_status).toBe('error');
    expect(classifyLiveSaleRow({ ...good, sale_date: '06/07/2026' }, ctx).match_status).toBe('error');
  });
});

describe('splitProductTypes', () => {
  it('splits, trims, lower-cases and drops blanks', () => {
    expect(splitProductTypes(' Internet , TV ,, home_phone ')).toEqual(['internet', 'tv', 'home_phone']);
    expect(splitProductTypes(null)).toEqual([]);
    expect(splitProductTypes('')).toEqual([]);
  });
});

describe('classifyHoldbackRow (opening balances — IMP-007)', () => {
  const base = { rep_code: 'RW-D-0001', origin_pay_period_id: 'p1', amount_held: '993.00' };
  const ctx = { repExists: true, originPeriodStatus: 'closed' as const, ledgerExists: false };

  it('rep + closed origin + no existing ledger → matched', () => {
    expect(classifyHoldbackRow(base, ctx).match_status).toBe('matched');
  });
  it('OPEN origin period → error (would collide with a future finalize)', () => {
    expect(classifyHoldbackRow(base, { ...ctx, originPeriodStatus: 'open' }).match_status).toBe('error');
  });
  it('missing origin period → error', () => {
    expect(classifyHoldbackRow(base, { ...ctx, originPeriodStatus: null }).match_status).toBe('error');
  });
  it('rep not found → error', () => {
    expect(classifyHoldbackRow(base, { ...ctx, repExists: false }).match_status).toBe('error');
  });
  it('existing ledger row for rep+origin → duplicate (re-import guard)', () => {
    expect(classifyHoldbackRow(base, { ...ctx, ledgerExists: true }).match_status).toBe('duplicate');
  });
  it('non-decimal amount → error', () => {
    expect(classifyHoldbackRow({ ...base, amount_held: 'x' }, ctx).match_status).toBe('error');
  });
});
