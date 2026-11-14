/**
 * StatusPill — design-system §6.7. Maps each sale lifecycle status to its semantic tone + label
 * (colour + text, never colour alone). Plus the "Proposed: confirm" chip for SRS-flagged rules.
 */
import { Badge } from './Badge';
import { STATUS_MAP, type SaleStatus } from './saleStatus';

export type { SaleStatus } from './saleStatus';

export function StatusPill({ status }: { status: SaleStatus }) {
  const { tone, label } = STATUS_MAP[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Marks an SRS-flagged proposed rule that needs Redwave confirmation (config screens). — §6.7 */
export function ProposedChip() {
  return <Badge tone="warning">Proposed: confirm</Badge>;
}
