/**
 * Base-price mode helpers — PURE (no Nest, no Prisma). — client request 2026-11-11 ("tiers off")
 *
 * planEndRows: how to END a set of effective-dated rows from a date WITHOUT creating a replacement — the one
 * thing the shared supersession (which always adds a new row) cannot do. Used when tiers are switched back
 * ON, so a product's tier-1 base price stops overriding the top bracket of the new ladder.
 *   - a row starting ON/AFTER `from` (pending)   → deleted, it never applied;
 *   - a row in force on `from` (current)          → bounded to the day before `from`;
 *   - a row that already ended before `from`      → untouched. A closed period is never rewritten (#10).
 */
import { previousDay } from '../../common/effective-dating';

export interface DatedRow {
  id: string;
  effective_from: Date;
  effective_to: Date | null;
}

export interface EndPlan {
  deleteIds: string[];
  bound: { id: string; effectiveTo: Date }[];
}

export function planEndRows(rows: DatedRow[], from: Date): EndPlan {
  const plan: EndPlan = { deleteIds: [], bound: [] };
  for (const r of rows) {
    if (r.effective_from.getTime() >= from.getTime()) {
      plan.deleteIds.push(r.id);
    } else if (r.effective_to === null || r.effective_to.getTime() >= from.getTime()) {
      plan.bound.push({ id: r.id, effectiveTo: previousDay(from) });
    }
  }
  return plan;
}

/** Whether a bracket set is "base-price mode": exactly one bracket covering every count. */
export function isBasePriceSchedule(tiers: { min_count: number; max_count: number | null }[]): boolean {
  return tiers.length === 1 && tiers[0].min_count === 0 && tiers[0].max_count === null;
}
