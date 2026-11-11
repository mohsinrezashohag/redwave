/**
 * Base-prices form ("tiers off") — schema + mapping. Pure. — client request 2026-11-11
 *
 * A product row left BLANK uses the scope's default price; the server then ends any old price it had, so a
 * blank really means "the default" and never "whatever was there before". Global takes the default only.
 */
import { z } from 'zod';
import type { SetBasePricesBody, TierRate } from '../commission.types';

const MONEY = /^\d+(\.\d{1,2})?$/;

export const basePricesSchema = z.object({
  effective_from: z.string().min(1, 'Pick the period the prices start'),
  effective_to: z.string(),
  default_rate: z.string().regex(MONEY, 'Enter a price, e.g. 145.00'),
  prices: z.array(
    z.object({
      product_id: z.string(),
      name: z.string(),
      amount: z.string().refine((v) => v.trim() === '' || MONEY.test(v.trim()), 'Enter a price or leave blank'),
    }),
  ),
});
export type BasePricesForm = z.infer<typeof basePricesSchema>;

/** One editable row per internet product, pre-filled with its CURRENT tier-1 price (blank = default). */
export function priceRows(
  products: { id: string; name: string; product_type: string; is_active?: boolean }[],
  currentRates: TierRate[],
): BasePricesForm['prices'] {
  return products
    .filter((p) => p.product_type === 'internet' && p.is_active !== false)
    .map((p) => {
      const rate = currentRates.find((r) => r.product_id === p.id && r.tier_number === 1);
      return { product_id: p.id, name: p.name, amount: rate ? rate.amount : '' };
    });
}

export function toBasePricesBody(values: BasePricesForm, clientId: string | undefined): SetBasePricesBody {
  return {
    client_id: clientId,
    effective_from: values.effective_from,
    effective_to: values.effective_to || undefined,
    default_rate: values.default_rate.trim(),
    // Global takes no product prices (server-enforced too).
    prices: clientId
      ? values.prices.filter((p) => p.amount.trim() !== '').map((p) => ({ product_id: p.product_id, amount: p.amount.trim() }))
      : [],
  };
}
