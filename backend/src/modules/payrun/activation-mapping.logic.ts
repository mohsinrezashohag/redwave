/**
 * Pure mapping from a stored sale_item to an engine ActivationInput. — CLAUDE §3 #9, SRS §17.2
 *
 * This is where the greenfield flag becomes the engine's flat-rate signal at period close: a
 * greenfield-confirmed internet activation (an internet product whose counts_toward_tally is false)
 * is presented to the engine as `greenfield_internet`, so the engine flat-rates it at $100 and
 * excludes it from the tally. Everything else passes its product_type through unchanged.
 */
import { ActivationInput, ProductType as EngineProductType } from '../engine/engine.types';

export interface SaleItemForMapping {
  id: string; // sale_item id — echoed back to freeze the snapshot
  product_type: string; // prisma ProductType string value
  counts_toward_tally: boolean;
  client_id: string;
  sale_date: string; // 'YYYY-MM-DD'
  // The specific product sold, for the per-product RATE lookup. Never the tally (#5) — that is still the
  // one cross-client count over product_type. Nullable, and a null simply falls back to the type rate.
  product_id?: string | null;
}

export function mapToEngineProductType(
  productType: string,
  countsTowardTally: boolean,
): EngineProductType {
  if (productType === EngineProductType.internet && !countsTowardTally) {
    return EngineProductType.greenfield_internet; // greenfield internet → flat, excluded
  }
  return productType as EngineProductType;
}

export function toActivationInput(item: SaleItemForMapping): ActivationInput {
  return {
    id: item.id,
    productType: mapToEngineProductType(item.product_type, item.counts_toward_tally),
    clientId: item.client_id,
    saleDate: item.sale_date,
    productId: item.product_id ?? null,
  };
}
