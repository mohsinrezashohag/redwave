/**
 * Shared schema + payload builders for the item-first expense form. The km amount is NEVER built
 * client-side (the server computes it) — km items send `km` (trip/total/stops with lat/lng); non-km items
 * send `amount` (+ receipt where the config requires). Stop coordinates come from Places geocoding when
 * Maps is enabled, else stubbed '0' (manual mode) and the server falls back to the client total_km.
 * Receipt-required is config-driven (passed in). One module so the form + nested fields share the types.
 */
import { z } from 'zod';
import type { CreateItemsBody, ExpenseItemInput, FieldConfig, TripType, UpdateItemBody } from '../expenses.types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
const KM = /^\d+(\.\d{1,6})?$/;

export interface StopValue {
  address: string;
  /** Captured from Places geocoding when Maps is enabled; '0' in manual fallback mode. */
  lat?: string;
  lng?: string;
}
export interface ItemValue {
  category: string;
  expense_date: string;
  client_id?: string;
  description: string;
  amount?: string;
  /** Currency of `amount` (ISO 4217; default CAD). km items are always CAD. Foreign freezes FX at approval (#12). */
  currency?: string;
  receipt_url?: string;
  /** Personal / do-not-reimburse (EXP-012) — excluded from reimbursable totals + pay run + client output. */
  is_personal?: boolean;
  /** Custom free-form tags (client + channel, EXP-002a). */
  tags?: string[];
  /**
   * Per-type CAPTURE fields ({key:value}), keyed by the category schema (EXP-002a). Metadata only (#1).
   * A value is `string | undefined`: RHF registers a key the moment its control mounts, so an untouched
   * OPTIONAL field legitimately holds `undefined` — the payload builder strips those.
   */
  field_values?: Record<string, string | undefined>;
  trip_type?: TripType;
  total_km?: string;
  stops?: StopValue[];
}
export interface ExpenseFormValues {
  rep_id?: string;
  items: ItemValue[];
}

/** Build the zod schema, driven by the field configs (dynamic per-type receipt rule + required fields). */
export function makeExpenseSchema(configs: FieldConfig[]) {
  const configFor = (category: string) => configs.find((c) => c.category_key === category);
  const item = z
    .object({
      category: z.string().min(1, 'Pick a category'),
      expense_date: z.string().regex(DATE, 'Date required'),
      client_id: z.string().optional(),
      description: z.string().min(1, 'Required').max(255),
      amount: z.string().optional(),
      currency: z.string().optional(),
      receipt_url: z.string().optional(),
      is_personal: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
      // A value may be undefined: mounting a dynamic control registers its key before the user types, so an
      // untouched OPTIONAL field would otherwise fail as "Invalid input". Required-ness is enforced by the
      // superRefine below (which reports against the FIELD, with its label) — not by the record's value type.
      field_values: z.record(z.string(), z.string().optional()).optional(),
      trip_type: z.enum(['single', 'round']).optional(),
      total_km: z.string().optional(),
      stops: z
        .array(z.object({ address: z.string().min(1, 'Address required'), lat: z.string().optional(), lng: z.string().optional() }))
        .optional(),
    })
    .superRefine((val, ctx) => {
      if (val.category === 'km') {
        if (!val.trip_type) ctx.addIssue({ code: 'custom', path: ['trip_type'], message: 'Pick a trip type' });
        if (!val.total_km || !KM.test(val.total_km)) ctx.addIssue({ code: 'custom', path: ['total_km'], message: 'Enter the total km' });
        if (!val.stops || val.stops.length < 2) ctx.addIssue({ code: 'custom', path: ['stops'], message: 'Add at least 2 stops' });
      } else {
        const cfg = configFor(val.category);
        if (!val.amount || !MONEY.test(val.amount)) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter an amount' });
        if (cfg?.requires_receipt && !val.receipt_url) ctx.addIssue({ code: 'custom', path: ['receipt_url'], message: 'Receipt required for this category' });
        // Required per-type capture fields → an Alert that blocks submit (EXP-013). Server re-validates.
        for (const def of cfg?.fields ?? []) {
          if (def.required && !val.field_values?.[def.key]?.trim()) {
            ctx.addIssue({ code: 'custom', path: ['field_values', def.key], message: `${def.label} is required` });
          }
        }
      }
    });

  return z
    .object({
      rep_id: z.string().optional(),
      items: z.array(item).min(1, 'Add at least one item'),
    })
    .superRefine((val, ctx) => {
      // One km log per day (the server also enforces one per rep/day with a 422).
      const kmDates = val.items.filter((i) => i.category === 'km').map((i) => i.expense_date);
      const dup = kmDates.find((d, i) => kmDates.indexOf(d) !== i);
      if (dup) ctx.addIssue({ code: 'custom', path: ['items'], message: `Only one km log per day (duplicate ${dup})` });
    });
}

/**
 * Keep only non-blank field values; undefined when empty (so the payload omits an empty object). Accepts
 * `undefined` values because a mounted-but-untouched optional control legitimately holds one.
 */
function pickNonBlank(values: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (!values) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (typeof v === 'string' && v.trim() !== '') out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/** Build ONE item payload from a validated form item (km amount omitted — server computes it). */
export function toItemInput(it: ItemValue): ExpenseItemInput {
  const base = {
    category: it.category as ExpenseItemInput['category'],
    client_id: it.client_id || undefined,
    expense_date: it.expense_date,
    description: it.description,
    // km is always CAD (server-forced); for others send the picked currency (CAD → omit, server default).
    currency: it.category === 'km' ? undefined : it.currency && it.currency !== 'CAD' ? it.currency : undefined,
    is_personal: it.is_personal || undefined,
    tags: it.tags && it.tags.length ? it.tags : undefined,
    // Per-type capture values — send only non-blank entries; the server drops unknown keys. Metadata (#1).
    field_values: pickNonBlank(it.field_values),
  };
  if (it.category === 'km') {
    return {
      ...base,
      km: {
        trip_type: it.trip_type!,
        total_km: it.total_km!,
        // Coordinates from Places when Maps is on; '0' in manual mode (the server re-derives the distance
        // from real coordinates and otherwise falls back to total_km).
        stops: (it.stops ?? []).map((s, i) => ({ stop_order: i, address: s.address, lat: s.lat || '0', lng: s.lng || '0' })),
      },
    };
  }
  return { ...base, amount: it.amount!, receipt_url: it.receipt_url || undefined };
}

/** Build the ADD-to-folder payload (one or several items) — the item inherits the folder's rep. — EXP-001 */
export function buildAddItemsBody(reportId: string, values: ExpenseFormValues): CreateItemsBody {
  return { expense_report_id: reportId, items: values.items.map(toItemInput) };
}

/** Build the EDIT payload (a single item) from the first form item. */
export function buildItemBody(values: ExpenseFormValues): UpdateItemBody {
  return toItemInput(values.items[0]);
}

/** A fresh blank item for a given category (km gets a trip type + two empty stops). */
export function blankItem(category: string, expense_date: string): ItemValue {
  if (category === 'km') {
    return { category, expense_date, description: '', currency: 'CAD', is_personal: false, tags: [], field_values: {}, trip_type: 'round', total_km: '', stops: [{ address: '' }, { address: '' }] };
  }
  return { category, expense_date, description: '', amount: '', currency: 'CAD', receipt_url: undefined, is_personal: false, tags: [], field_values: {} };
}
