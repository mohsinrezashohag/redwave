/**
 * Price chart — a pure projection of a client's billing rates into "what this client is charged TODAY,
 * and what changes next". The effective-dated table is the AUDIT history (every version of every rate);
 * this is the at-a-glance rate card the client record was missing.
 *
 * Selection only — NO arithmetic on money (#1): amounts pass through as the server's decimal strings.
 * Statuses are SERVER-derived (`current`/`pending`/`past`); nothing here does date math.
 * Billing stream only (#3) — commission rates are a separate screen and are never read here.
 */
import type { BillingRate, Product, RateKind } from './clients.types';

export interface PriceRow {
  key: string;
  /** What the rate targets: a product name, a bundle trigger, or the client-wide add-on kind. */
  label: string;
  /** Secondary line — product type, or the rate kind for client-wide rows. */
  detail: string;
  rateKind: RateKind;
  /** The rate in force today, or null when the product has never been priced. */
  current: BillingRate | null;
  /** The next scheduled change, if any. */
  pending: BillingRate | null;
}

const byKind = (r: BillingRate) => r.rate_kind;

/**
 * One row per PRODUCT (priced or not — an unpriced product is the thing that 422s a statement, so it must
 * be visible), followed by one row per client-wide rate (add-on kinds, bundles, spiffs).
 */
export function buildPriceChart(
  products: Product[],
  rates: BillingRate[],
  productTypeLabel: (key: string) => string,
): PriceRow[] {
  const pick = (list: BillingRate[], status: 'current' | 'pending') =>
    list.find((r) => r.status === status) ?? null;

  const productRows: PriceRow[] = products.map((p) => {
    const forProduct = rates.filter((r) => r.rate_kind === 'product' && r.product_id === p.id);
    return {
      key: `product:${p.id}`,
      label: p.name,
      detail: productTypeLabel(p.product_type),
      rateKind: 'product' as RateKind,
      current: pick(forProduct, 'current'),
      pending: pick(forProduct, 'pending'),
    };
  });

  // Client-wide rates carry no product_id. A bundle is identified by its trigger SET, so each distinct
  // trigger is its own row; the other kinds are one row each.
  const wide = rates.filter((r) => r.rate_kind !== 'product');
  const groups = new Map<string, BillingRate[]>();
  for (const r of wide) {
    const key = r.rate_kind === 'bundle_bonus' ? `bundle:${r.bundle_product_types.join('+')}` : `kind:${byKind(r)}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const KIND_LABEL: Record<RateKind, string> = {
    product: 'Product rate',
    tv_addon: 'TV add-on',
    hp_addon: 'Home-phone add-on',
    bundle_bonus: 'Bundle bonus',
    spiff: 'Spiff',
  };

  const wideRows: PriceRow[] = [...groups.entries()].map(([key, list]) => {
    const sample = list[0];
    return {
      key,
      label:
        sample.rate_kind === 'bundle_bonus'
          ? sample.bundle_product_types.map(productTypeLabel).join(' + ') || 'Bundle'
          : KIND_LABEL[sample.rate_kind],
      detail: sample.rate_kind === 'bundle_bonus' ? 'Bundle bonus — applies when all types are on one sale' : 'Client-wide',
      rateKind: sample.rate_kind,
      current: pick(list, 'current'),
      pending: pick(list, 'pending'),
    };
  });

  return [...productRows, ...wideRows];
}

/** Products with no rate in force today — these are exactly what makes a statement 422 as "unpriced". */
export const unpricedRows = (rows: PriceRow[]): PriceRow[] =>
  rows.filter((r) => r.rateKind === 'product' && r.current === null);
