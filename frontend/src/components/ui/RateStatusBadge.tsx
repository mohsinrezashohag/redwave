/**
 * RateStatusBadge — the SHARED effective-dating status pill (current/pending/past). Domain-agnostic: it
 * renders the server-derived `status` for ANY effective-dated config row (client billing rates, commission
 * rep rates, billing rates). Colour always pairs with text (via Badge). Tokens only. — CLAUDE #10
 */
import { Badge, type BadgeTone } from './Badge';

/** The status the server derives for an effective-dated row. */
export type RateStatus = 'past' | 'current' | 'pending';

const MAP: Record<RateStatus, { tone: BadgeTone; label: string }> = {
  current: { tone: 'success', label: 'Current' },
  pending: { tone: 'warning', label: 'Pending' },
  past: { tone: 'muted', label: 'Past' },
};

export function RateStatusBadge({ status }: { status: RateStatus }) {
  const { tone, label } = MAP[status];
  return <Badge tone={tone}>{label}</Badge>;
}
