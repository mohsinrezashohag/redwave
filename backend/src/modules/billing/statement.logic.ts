/**
 * Client-statement aggregation — PURE & deterministic (no I/O, no Prisma, no dates, no clock).
 *
 * Builds the client-facing statement line from sales whose components the SERVICE has ALREADY resolved from
 * `client_billing_rates` (effective-dated selection happens there, on each sale's `sale_date`). A `Sale` is a
 * customer/household, so it becomes ONE line — but that line now carries the amount contributed by EACH rate
 * kind, not a single blended total, because that is what Redwave sends the client.
 * — SRS BILL-001 / docs/uat/billing-target-format.md
 *
 * This module reads ONLY billing-rate amounts passed in by the service; it has ZERO awareness of the
 * commission stream (#3 — the streams never mix). The invoice total reuses `buildStatement(...).total_amount`,
 * so the invoice and statement totals are structurally identical (#1 exact decimal).
 *
 * Money is exact decimal (decimal.js), never float (CLAUDE §3 #1).
 */
import { Decimal } from 'decimal.js';

export interface PricedItem {
  /** The product's id, or null for a synthetic BUNDLE charge (a bundle is not a product). */
  product_id: string | null;
  product_name: string;
  /** The client_billing_rate amount in force on the sale's sale_date, or null if none is configured. */
  rate: Decimal | null;
}

/** The per-rate-kind amounts the service resolved for one sale. A component with no rate is zero, not null. */
export interface SaleComponents {
  internet: Decimal;
  tv: Decimal;
  home_phone: Decimal;
  bundle: Decimal;
  spiff: Decimal;
  /** Priced products with no column of their own (Wireless / Protection Plan / Mesh / …) — never dropped. */
  other: Decimal;
}

export interface SaleInput {
  sale_id: string;
  sale_date: string; // 'YYYY-MM-DD'
  rep_code: string;
  rep_name: string;
  customer_name: string;
  customer_first_name: string | null;
  customer_last_name: string | null;
  address: string;
  channel: string;
  /** The internet speed product on this sale, or '' when the sale has no internet component. */
  product_name: string;
  has_internet: boolean;
  has_tv: boolean;
  has_home_phone: boolean;
  components: SaleComponents;
  /** Every product name on the sale, for the summary string the UI + QuickBooks CSV still use. */
  items: PricedItem[];
}

export interface StatementLineDraft {
  sale_id: string;
  sort_order: number;
  sale_date: string;
  rep_code: string;
  rep_name: string;
  customer_name: string;
  customer_first_name: string;
  customer_last_name: string;
  address: string;
  channel: string;
  product_name: string;
  has_internet: boolean;
  has_tv: boolean;
  has_home_phone: boolean;
  internet_rate: Decimal;
  tv_rate: Decimal;
  hp_rate: Decimal;
  bundle_bonus: Decimal;
  spiff: Decimal;
  other_total: Decimal;
  products_summary: string;
  line_total: Decimal;
}

export interface StatementDraft {
  lines: StatementLineDraft[];
  total_amount: Decimal;
}

/** Distinct product names, in first-seen order, joined `", "` (e.g. "Internet, TV, Home Phone"). */
function summariseProducts(items: PricedItem[]): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of items) {
    if (!seen.has(item.product_name)) {
      seen.add(item.product_name);
      names.push(item.product_name);
    }
  }
  return names.join(', ');
}

/**
 * Best-effort split of a single-field name into first + last, used ONLY for sales entered before `sales`
 * carried the pair. First token is the first name, the remainder the last — imperfect for a multi-word first
 * name, which is exactly why new sales capture the two separately rather than relying on this.
 */
export function splitCustomerName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * Aggregate priced sales into one statement line per sale (= per customer/household). `line_total` is the
 * EXACT sum of the six components, so the workbook's Total column always reconciles against its own row
 * (#1 — no lost cent, no re-derivation downstream). The SERVICE rejects unpriced products (422) BEFORE
 * calling this, so a zero component means "not sold" or "not configured", never "unknown".
 * — SRS BILL-001
 */
export function buildStatement(sales: SaleInput[]): StatementDraft {
  const lines = sales.map((sale, index) => {
    const c = sale.components;
    const line_total = c.internet
      .plus(c.tv)
      .plus(c.home_phone)
      .plus(c.bundle)
      .plus(c.spiff)
      .plus(c.other);
    const fallback = splitCustomerName(sale.customer_name);
    return {
      sale_id: sale.sale_id,
      sort_order: index,
      sale_date: sale.sale_date,
      rep_code: sale.rep_code,
      rep_name: sale.rep_name,
      customer_name: sale.customer_name,
      customer_first_name: sale.customer_first_name ?? fallback.first,
      customer_last_name: sale.customer_last_name ?? fallback.last,
      address: sale.address,
      channel: sale.channel,
      product_name: sale.product_name,
      has_internet: sale.has_internet,
      has_tv: sale.has_tv,
      has_home_phone: sale.has_home_phone,
      internet_rate: c.internet,
      tv_rate: c.tv,
      hp_rate: c.home_phone,
      bundle_bonus: c.bundle,
      spiff: c.spiff,
      other_total: c.other,
      products_summary: summariseProducts(sale.items),
      line_total,
    };
  });
  const total_amount = lines.reduce((sum, line) => sum.plus(line.line_total), new Decimal(0));
  return { lines, total_amount };
}
