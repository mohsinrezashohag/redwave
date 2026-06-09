/**
 * Shared schema + payload builders for the item-first expense form. The km amount is NEVER built
 * client-side (the server computes it) — km items send `km` (trip/total/stops with lat/lng); non-km items
 * send `amount` (+ receipt where the config requires). Stop coordinates come from Places geocoding when
 * Maps is enabled, else stubbed '0' (manual mode) and the server falls back to the client total_km.
 * Receipt-required is config-driven (passed in). One module so the form + nested fields share the types.
 */
import { z } from 'zod';
import type { CreateItemsBody, ExpenseItemInput, TripType, UpdateItemBody } from '../expenses.types';

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
  receipt_url?: string;
  trip_type?: TripType;
  total_km?: string;
  stops?: StopValue[];
}
export interface ExpenseFormValues {
  rep_id?: string;
  items: ItemValue[];
}

/** Build the zod schema; `requiresReceipt(category)` comes from the field configs (dynamic). */
export function makeExpenseSchema(requiresReceipt: (category: string) => boolean) {
  const item = z
    .object({
      category: z.string().min(1, 'Pick a category'),
      expense_date: z.string().regex(DATE, 'Date required'),
      client_id: z.string().optional(),
      description: z.string().min(1, 'Required').max(255),
      amount: z.string().optional(),
      receipt_url: z.string().optional(),
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
        if (!val.amount || !MONEY.test(val.amount)) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter an amount' });
        if (requiresReceipt(val.category) && !val.receipt_url) ctx.addIssue({ code: 'custom', path: ['receipt_url'], message: 'Receipt required for this category' });
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

/** Build ONE item payload from a validated form item (km amount omitted — server computes it). */
function toItemInput(it: ItemValue): ExpenseItemInput {
  const base = {
    category: it.category as ExpenseItemInput['category'],
    client_id: it.client_id || undefined,
    expense_date: it.expense_date,
    description: it.description,
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

/** Build the CREATE payload (one or several items) from validated form values. */
export function buildItemsBody(values: ExpenseFormValues): CreateItemsBody {
  return { rep_id: values.rep_id || undefined, items: values.items.map(toItemInput) };
}

/** Build the EDIT payload (a single item) from the first form item. */
export function buildItemBody(values: ExpenseFormValues): UpdateItemBody {
  return toItemInput(values.items[0]);
}

/** A fresh blank item for a given category (km gets a trip type + two empty stops). */
export function blankItem(category: string, expense_date: string): ItemValue {
  if (category === 'km') {
    return { category, expense_date, description: '', trip_type: 'round', total_km: '', stops: [{ address: '' }, { address: '' }] };
  }
  return { category, expense_date, description: '', amount: '', receipt_url: undefined };
}
