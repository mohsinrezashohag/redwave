/**
 * StatusPill — design-system §6.7. Maps each sale lifecycle status to its semantic tone + label
 * (colour + text, never colour alone). Plus the "Proposed — confirm" chip for SRS-flagged rules.
 */
import { Badge, type BadgeTone } from './Badge';

export type SaleStatus =
  | 'entered'
  | 'validated'
  | 'in_pay_run'
  | 'paid'
  | 'clawed_back'
  | 'deleted'
  | 'historical'
  | 'pending';

const STATUS_MAP: Record<SaleStatus, { tone: BadgeTone; label: string }> = {
  entered: { tone: 'neutral', label: 'Entered' },
  validated: { tone: 'success', label: 'Validated' },
  in_pay_run: { tone: 'info', label: 'In Pay Run' },
  paid: { tone: 'success', label: 'Paid' },
  clawed_back: { tone: 'danger', label: 'Clawed Back' },
  deleted: { tone: 'muted', label: 'Deleted' },
  historical: { tone: 'muted', label: 'Historical' }, // migrated/reference-only — never in the pay pipeline
  pending: { tone: 'warning', label: 'Pending' },
};

export function StatusPill({ status }: { status: SaleStatus }) {
  const { tone, label } = STATUS_MAP[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Marks an SRS-flagged proposed rule that needs Redwave confirmation (config screens). — §6.7 */
export function ProposedChip() {
  return <Badge tone="warning">Proposed — confirm</Badge>;
}
