/**
 * Client-statement aggregation — PURE & deterministic (no I/O, no Prisma, no dates).
 *
 * Builds the "one line per customer" client statement from already-fetched sales whose items have
 * ALREADY been priced from `client_billing_rates` (the service does the effective-dated selection
 * and hands the resolved rate in). A `Sale` is a customer/household; its items are the products —
 * so each sale becomes ONE statement line aggregating all its products. — SRS BILL-001
 *
 * This module reads ONLY billing-rate amounts passed in by the service; it has ZERO awareness of the
 * commission stream (#3 — the streams never mix). The invoice total reuses `buildStatement(...)
 * .total_amount`, so the invoice and statement totals are structurally identical (#1 exact decimal).
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

export interface SaleInput {
  sale_id: string;
  customer_name: string;
  items: PricedItem[];
}

export interface StatementLineDraft {
  sale_id: string;
  customer_name: string;
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
 * Aggregate priced sales into one statement line per sale (= per customer/household), summing every
 * product's billing rate onto that single line. A null rate is treated as 0 here — but the SERVICE
 * rejects unpriced items (422) BEFORE calling this, so in practice every rate is present (#2 policy
 * lives in the service; this stays pure). — SRS BILL-001
 */
export function buildStatement(sales: SaleInput[]): StatementDraft {
  const lines = sales.map((sale) => {
    const line_total = sale.items.reduce(
      (sum, item) => sum.plus(item.rate ?? new Decimal(0)),
      new Decimal(0),
    );
    return {
      sale_id: sale.sale_id,
      customer_name: sale.customer_name,
      products_summary: summariseProducts(sale.items),
      line_total,
    };
  });
  const total_amount = lines.reduce((sum, line) => sum.plus(line.line_total), new Decimal(0));
  return { lines, total_amount };
}
