/**
 * saleExport — project a sale into the CLIENT-BILL column shape: presence flags per component and the
 * amount beside each, instead of one `"Internet, TV, Home Phone"` cell with no price. Same component
 * split the statement renderer uses (Internet / TV / Home Phone, everything else into "Other"), so a
 * sales export lines up against a bill column-for-column.
 *
 * The money here is the FROZEN COMMISSION snapshot (`sale_items.rate_applied`) — what the REP earned, set
 * once at pay-run finalize (#2). It is deliberately BLANK on an entered/validated sale, because such a sale
 * genuinely has no amount yet; showing a zero would read as "earned nothing". This never reads a client
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
const INTERNET_BEHAVIOURS = new Set(['tiered', 'greenfield']);

export interface SaleExportRow {
  /** The internet speed product on the sale ('' when it has no internet component). */
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
  /** The sum of the four above — '' when the sale is unpaid. */
  total: string;
}

/** A rate only exists once Pay Run froze it; treat anything else as "not yet priced". */
const rateOf = (item: SaleItem): string | null => item.rate_applied ?? null;

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
  let product_name = '';
  let has_internet = false;
  let has_tv = false;
  let has_home_phone = false;

  for (const item of sale.sale_items) {
    const rate = rateOf(item);
    if (isInternet(item)) {
      has_internet = true;
      if (!product_name) product_name = item.product?.name ?? '';
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
    product_name,
    has_internet,
    has_tv,
    has_home_phone,
    internet_rate: sumOrBlank(internet),
    tv_rate: sumOrBlank(tv),
    hp_rate: sumOrBlank(hp),
    other_total: sumOrBlank(other),
    total: sumOrBlank(all),
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
