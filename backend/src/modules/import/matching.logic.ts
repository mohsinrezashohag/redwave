/**
 * Row classification — PURE & deterministic (no I/O). Given a row's mapped data plus the context the
 * service pre-fetched from the DB, decide the row's `match_status` + an operator-facing `issue`. All
 * DB lookups (matching sales, rep/period existence, existing ledger) happen in the service and are
 * passed in as primitives, keeping this fully unit-testable. — SRS §15 (IMP-003/004/005/007)
 */
import { MatchStatus } from '@prisma/client';
import { RawRow } from './mapping.logic';

export interface Classification {
  match_status: MatchStatus;
  issue: string | null;
  matched_entity_id?: string;
}

const MONEY = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = (row: RawRow, key: string): string | null => {
  const v = row[key];
  return v === undefined || v === null || v === '' ? null : String(v);
};

const matched = (id?: string): Classification => ({
  match_status: 'matched',
  issue: null,
  ...(id ? { matched_entity_id: id } : {}),
});
const error = (issue: string): Classification => ({ match_status: 'error', issue });

// ── client_report + sales (bulk validation; SALE-007 / IMP-010) ──────────────────────────────────
/** `matchedSaleIds` = the `entered` sales the service found for this row's MPU + client. */
export function classifySalesRow(
  mapped: RawRow,
  ctx: { matchedSaleIds: string[] },
): Classification {
  const mpuId = str(mapped, 'mpu_id');
  if (ctx.matchedSaleIds.length === 1) {
    return matched(ctx.matchedSaleIds[0]);
  }
  if (ctx.matchedSaleIds.length > 1) {
    return { match_status: 'duplicate', issue: `multiple entered sales match MPU ${mpuId}` };
  }
  return {
    match_status: 'unmatched',
    issue: mpuId ? `no entered sale matches MPU ${mpuId}` : 'no MPU ID — manual match required',
  };
}

// ── master_migration + billing_rates (back-dated billing rates; #10) ─────────────────────────────
/** Shape + existence (existence flags pre-fetched by the service from the friendly client_code/product_name). */
export function classifyBillingRateRow(
  mapped: RawRow,
  ctx: { clientExists: boolean; productExists: boolean },
): Classification {
  const client_code = str(mapped, 'client_code');
  const rate_kind = str(mapped, 'rate_kind');
  const amount = str(mapped, 'amount');
  const effective_from = str(mapped, 'effective_from');
  const product_name = str(mapped, 'product_name');
  const effective_to = str(mapped, 'effective_to');

  if (!client_code) return error('client_code is required');
  if (!rate_kind) return error('rate_kind is required');
  if (rate_kind === 'product' && !product_name) return error("rate_kind 'product' requires a product_name");
  if (!amount || !MONEY.test(amount)) return error('amount must be a decimal string (≤2 dp)');
  if (!effective_from || !DATE.test(effective_from)) return error('effective_from must be YYYY-MM-DD');
  if (effective_to && !DATE.test(effective_to)) return error('effective_to must be YYYY-MM-DD');
  if (!ctx.clientExists) return error(`client ${client_code} not found`);
  if (rate_kind === 'product' && !ctx.productExists) return error(`product "${product_name}" not found for this client`);
  return matched();
}

// ── master_migration + clients (create/upsert clients) ───────────────────────────────────────────
export function classifyClientRow(mapped: RawRow, ctx: { existingClientId: string | null }): Classification {
  const client_code = str(mapped, 'client_code');
  const name = str(mapped, 'name');
  const market = (str(mapped, 'market') ?? '').toUpperCase();
  if (!client_code) return error('client_code is required');
  if (!name) return error('name is required');
  if (market !== 'CA' && market !== 'US') return error('market must be CA or US');
  return matched(ctx.existingClientId ?? undefined); // existing → update; else create
}

// ── master_migration + products (create products + optional inline rate) ─────────────────────────
export function classifyProductRow(
  mapped: RawRow,
  ctx: { clientExists: boolean; productTypeExists: boolean },
): Classification {
  const client_code = str(mapped, 'client_code');
  const name = str(mapped, 'name');
  const product_type = str(mapped, 'product_type');
  const billing_amount = str(mapped, 'billing_amount');
  const effective_from = str(mapped, 'effective_from');
  if (!client_code) return error('client_code is required');
  if (!name) return error('name is required');
  if (!product_type) return error('product_type is required');
  if (!ctx.clientExists) return error(`client ${client_code} not found`);
  if (!ctx.productTypeExists) return error(`product_type "${product_type}" is not in the catalogue`);
  if (billing_amount) {
    if (!MONEY.test(billing_amount)) return error('billing_amount must be a decimal string (≤2 dp)');
    if (!effective_from || !DATE.test(effective_from)) return error('a billing_amount requires effective_from (YYYY-MM-DD)');
  }
  return matched();
}

// ── master_migration + reps (create reps; rep_code never reused, #11) ────────────────────────────
export function classifyRepRow(mapped: RawRow, ctx: { codeExists: boolean }): Classification {
  const rep_code = str(mapped, 'rep_code');
  const full_name = str(mapped, 'full_name');
  const hire_date = str(mapped, 'hire_date');
  if (!rep_code) return error('rep_code is required');
  if (!full_name) return error('full_name is required');
  if (!hire_date || !DATE.test(hire_date)) return error('hire_date must be YYYY-MM-DD');
  if (ctx.codeExists) return error(`rep_code ${rep_code} already exists — codes are never reused (#11)`);
  return matched();
}

// ── master_migration + sales (HISTORICAL — reference-only; never paid) ───────────────────────────
export function classifyHistoricalSaleRow(
  mapped: RawRow,
  ctx: { clientExists: boolean; repExists: boolean; productExists: boolean },
): Classification {
  const client_code = str(mapped, 'client_code');
  const rep_code = str(mapped, 'rep_code');
  const product_type = str(mapped, 'product_type');
  const sale_date = str(mapped, 'sale_date');
  const billed_amount = str(mapped, 'billed_amount');
  if (!client_code) return error('client_code is required');
  if (!rep_code) return error('rep_code is required');
  if (!product_type) return error('product_type is required');
  if (!sale_date || !DATE.test(sale_date)) return error('sale_date must be YYYY-MM-DD');
  if (!billed_amount || !MONEY.test(billed_amount)) return error('billed_amount must be a decimal string (≤2 dp)');
  if (!ctx.clientExists) return error(`client ${client_code} not found`);
  if (!ctx.repExists) return error(`rep ${rep_code} not found`);
  if (!ctx.productExists) return error(`no ${product_type} product for client ${client_code} — import products first`);
  return matched();
}

// ── sales_entry + sales (LIVE sale entry; IMP-013) ───────────────────────────────────────────────
/** Split the comma-separated `product_types` column into normalised type keys. */
export const splitProductTypes = (value: string | null): string[] =>
  (value ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

const LIVE_SALE_STATUSES = ['entered', 'validated'];

/**
 * A LIVE sale row. Unlike the historical target these become real sales that reach the engine, so every
 * reference must already exist — an unresolvable client / rep / product is an ERROR, never an implicit
 * create. The mandatory internet base (SALE-001a) is checked HERE so a bad row surfaces as `error` and the
 * reconcile gate blocks the commit, instead of throwing mid-transaction and rolling the whole batch back.
 */
export function classifyLiveSaleRow(
  mapped: RawRow,
  ctx: {
    clientExists: boolean;
    /** The rep exists AND is active (SalesService rejects an inactive rep). */
    repActive: boolean;
    /** Listed types that have NO active product for this client. */
    missingProductTypes: string[];
    /** True when at least one listed type has catalogue behaviour `tiered` or `greenfield`. */
    hasInternetBase: boolean;
  },
): Classification {
  const client_code = str(mapped, 'client_code');
  const rep_code = str(mapped, 'rep_code');
  const productTypes = splitProductTypes(str(mapped, 'product_types'));
  const sale_date = str(mapped, 'sale_date');
  const customer_name = str(mapped, 'customer_name');
  const status = (str(mapped, 'status') ?? 'entered').toLowerCase();

  if (!client_code) return error('client_code is required');
  if (!rep_code) return error('rep_code is required');
  if (productTypes.length === 0) return error('product_types is required (comma-separated)');
  if (!sale_date || !DATE.test(sale_date)) return error('sale_date must be YYYY-MM-DD');
  if (!customer_name) return error('customer_name is required');
  if (!LIVE_SALE_STATUSES.includes(status)) {
    return error(`status must be entered or validated (got "${status}")`);
  }
  if (!ctx.clientExists) return error(`client ${client_code} not found`);
  if (!ctx.repActive) return error(`rep ${rep_code} not found or not active`);
  if (ctx.missingProductTypes.length > 0) {
    return error(
      `no active ${ctx.missingProductTypes.join(', ')} product for client ${client_code} — import products first`,
    );
  }
  // SALE-001a — internet is the mandatory base; add-ons cannot be sold standalone.
  if (!ctx.hasInternetBase) {
    return error(
      'a sale must include an internet activation (the mandatory base); add-ons cannot be sold standalone',
    );
  }
  return matched();
}

// ── balance_migration + holdback (opening balances; IMP-007) ─────────────────────────────────────
/** ctx is pre-fetched by the service: rep existence, origin period status, and any existing ledger row. */
export function classifyHoldbackRow(
  mapped: RawRow,
  ctx: { repExists: boolean; originPeriodStatus: 'open' | 'closed' | 'paid' | null; ledgerExists: boolean },
): Classification {
  const rep_code = str(mapped, 'rep_code');
  const origin = str(mapped, 'origin_pay_period_id');
  const amount = str(mapped, 'amount_held');

  if (!rep_code) return error('rep_code is required');
  if (!origin) return error('origin_pay_period_id is required');
  if (!amount || !MONEY.test(amount)) return error('amount_held must be a decimal string (≤2 dp)');
  if (!ctx.repExists) return error('rep not found');
  if (ctx.originPeriodStatus === null) return error('origin pay period not found');
  // An OPEN origin would collide with a future finalize's freeze-once slot and underpay the rep. — seam
  if (ctx.originPeriodStatus === 'open') {
    return error('origin pay period is open — opening balances require a closed/paid period');
  }
  // Idempotent against re-import: one opening balance per rep + origin (mirrors Pay Run freeze-once).
  if (ctx.ledgerExists) {
    return { match_status: 'duplicate', issue: 'a holdback already exists for this rep + origin period' };
  }
  return matched();
}
