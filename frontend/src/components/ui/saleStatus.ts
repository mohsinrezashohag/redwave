/**
 * Sale status labels + tones (design-system §6.7), shared by StatusPill and the plain-text uses (exports).
 * Kept apart from the component file so React fast refresh keeps working.
 */
import type { BadgeTone } from './Badge';

export type SaleStatus =
  | 'entered'
  | 'validated'
  | 'in_pay_run'
  | 'paid'
  | 'clawed_back'
  | 'deleted'
  | 'historical'
  | 'pending';

export const STATUS_MAP: Record<SaleStatus, { tone: BadgeTone; label: string }> = {
  entered: { tone: 'neutral', label: 'Entered' },
  validated: { tone: 'success', label: 'Validated' },
  in_pay_run: { tone: 'info', label: 'In Pay Run' },
  paid: { tone: 'success', label: 'Paid' },
  clawed_back: { tone: 'danger', label: 'Clawed Back' },
  deleted: { tone: 'muted', label: 'Deleted' },
  historical: { tone: 'muted', label: 'Historical' }, // migrated/reference-only — never in the pay pipeline
  pending: { tone: 'warning', label: 'Pending' },
};

/** The human label of a sale status ('clawed_back' → 'Clawed Back'), for exports and text. */
export function saleStatusLabel(status: SaleStatus): string {
  return STATUS_MAP[status]?.label ?? status;
}
