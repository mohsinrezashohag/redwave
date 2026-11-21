/**
 * PayRunStatusBadge — maps a pay-run status to a semantic Badge (StatusPill covers SALE statuses, not
 * these). draft = work-in-progress, finalized = marked as paid (locked), exported = paid + ADP file generated. Tokens
 * only (via Badge).
 */
import { Badge, type BadgeTone } from '../../../components/ui';
import type { PayRunStatus } from '../payrun.types';

const MAP: Record<PayRunStatus, { tone: BadgeTone; label: string }> = {
  draft: { tone: 'info', label: 'Draft' },
  finalized: { tone: 'success', label: 'Paid' },
  exported: { tone: 'accent', label: 'Paid, exported' },
};

export function PayRunStatusBadge({ status }: { status: PayRunStatus }) {
  const { tone, label } = MAP[status];
  return <Badge tone={tone}>{label}</Badge>;
}
