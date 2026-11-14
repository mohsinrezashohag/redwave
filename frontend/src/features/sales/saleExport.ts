/**
 * saleExport — project a sale into the CLIENT-BILL column shape: presence flags per component and the
 * amount beside each, instead of one `"Internet, TV, Home Phone"` cell with no price. Same component
 * split the statement renderer uses (Internet / TV / Home Phone, everything else into "Other"), so a
 * sales export lines up against a bill column-for-column.
 *
 * The money here is the REP's rate: the FROZEN snapshot (`sale_items.rate_applied`) once the pay run has
 * paid the item (#2), else — since 2026-11-15, when tiers went and every item pays one flat rate — the rate
 * IN FORCE on the sale date (`estimated_rate`, server-resolved exactly as the pay run will). Redwave applies
 * tiers and splits in Excel from this file, so it needs the rate before the pay run. `rate_basis` says
 * which it is ('Paid' / 'Estimated'); an item with no rate set stays BLANK, never a zero. This never reads a client
 * billing rate: the two rate streams stay separate (#3), and a rep's export never reveals what the client
 * is charged.
 *
 * PURE — no I/O, no clock. Money is passed through as the server's exact decimal string and only ever
 * ADDED via `sumMoney` (integer cents), never with float arithmetic (#1).
 */
import { sumMoney } from '../../lib/format/money';
import type { Sale, SaleItem } from './sales.types';

/** Core catalogue keys the bill prints as their own columns (is_system, so these keys are stable). */
const TV_KEY = 'tv';
const HOME_PHONE_KEY = 'home_phone';
/** Catalogue behaviours that count as "Internet" — mirrors `statement.service.ts`. */
const INTERNET_BEHAVIOURS = new Set(['internet', 'greenfield']);

export interface SaleExportRow {
  /** Every product on the sale, internet first ('Fibre 150 + Basic TV'). */
  product_name: string;
  has_internet: boolean;
  has_tv: boolean;
  has_home_phone: boolean;
  /** Decimal strings, or '' when the sale has not been paid (so nothing is frozen yet). */
  internet_rate: string;
  tv_rate: string;
  hp_rate: string;
  /** Priced components with no column of their own (Wireless / Protection Plan / Mesh / …). */
  other_total: string;
  /** The sum of the four above — '' when nothing on the sale is priced. */
  total: string;
  /** Incentives frozen on the sale at pay run ('' when none). */
  incentive: string;
  /** 'Paid' = frozen at pay run; 'Estimated' = rate in force, may change before the pay run; '' = no rate. */
  rate_basis: '' | 'Paid' | 'Estimated';
}

/** The frozen rate once paid, else the server's rate in force; null = no rate set. */
const rateOf = (item: SaleItem): string | null => item.rate_applied ?? item.estimated_rate ?? null;

const sumOrBlank = (values: string[]): string => (values.length > 0 ? sumMoney(values) : '');

/**
 * @param behaviourByType catalogue key → behaviour (from `useProductTypes`). An unknown key is treated as
 * an add-on, which is the safe default: it lands in "Other" rather than being counted as internet.
 */
export function toSaleExportRow(sale: Sale, behaviourByType: Map<string, string>): SaleExportRow {
  const isInternet = (item: SaleItem) => INTERNET_BEHAVIOURS.has(behaviourByType.get(item.product_type) ?? '');

  const internet: string[] = [];
  const tv: string[] = [];
  const hp: string[] = [];
  const other: string[] = [];
  const names: string[] = [];
  let has_internet = false;
  let has_tv = false;
  let has_home_phone = false;

  let estimated = false;
  let frozen = false;
  const incentives: string[] = [];
  // Internet first, so the Product cell reads like the sale: 'Fibre 150 + Basic TV'.
  const ordered = [...sale.sale_items].sort((a, b) => Number(isInternet(b)) - Number(isInternet(a)));
  for (const item of ordered) {
    const rate = rateOf(item);
    if (item.product?.name) names.push(item.product.name);
    if (item.rate_applied) frozen = true;
    else if (rate) estimated = true;
    if (item.incentive_amount && Number(item.incentive_amount) !== 0) incentives.push(item.incentive_amount);
    if (isInternet(item)) {
      has_internet = true;
      if (rate) internet.push(rate);
    } else if (item.product_type === TV_KEY) {
      has_tv = true;
      if (rate) tv.push(rate);
    } else if (item.product_type === HOME_PHONE_KEY) {
      has_home_phone = true;
      if (rate) hp.push(rate);
    } else if (rate) {
      other.push(rate);
    }
  }

  const all = [...internet, ...tv, ...hp, ...other];
  return {
    product_name: names.join(' + '),
    has_internet,
    has_tv,
    has_home_phone,
    internet_rate: sumOrBlank(internet),
    tv_rate: sumOrBlank(tv),
    hp_rate: sumOrBlank(hp),
    other_total: sumOrBlank(other),
    total: sumOrBlank(all),
    incentive: sumOrBlank(incentives),
    rate_basis: estimated ? 'Estimated' : frozen ? 'Paid' : '',
  };
}

/**
 * An accessor that projects each sale ONCE. The export column API is row-at-a-time, so without this every
 * one of the ~9 component columns would re-derive the same row. Cached on the sale's identity — the
 * projection is pure, so a cache hit is indistinguishable from recomputing.
 */
export function saleExportRowAccessor(behaviourByType: Map<string, string>): (sale: Sale) => SaleExportRow {
  const cache = new WeakMap<Sale, SaleExportRow>();
  return (sale) => {
    const hit = cache.get(sale);
    if (hit) return hit;
    const row = toSaleExportRow(sale, behaviourByType);
    cache.set(sale, row);
    return row;
  };
}
