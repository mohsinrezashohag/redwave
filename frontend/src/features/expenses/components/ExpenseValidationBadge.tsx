/**
 * ExpenseValidationBadge — a compact per-item Alert/Warning indicator (EXP-013). Alert → danger, Warning →
 * warning; a Tooltip lists the rule messages. Renders nothing when the item is clean. Reads the server's
 * DERIVED `validation` block (the FE never recomputes what the server sends here). Tokens only (via Badge).
 */
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Badge, Tooltip } from '../../../components/ui';
import type { ItemValidation } from '../expenses.types';

export function ExpenseValidationBadge({ validation }: { validation: ItemValidation | undefined }) {
  if (!validation || (validation.alert_count === 0 && validation.warning_count === 0)) return null;
  const isAlert = validation.alert_count > 0;
  const rules = isAlert ? validation.alerts : validation.warnings;
  const label = isAlert ? `${validation.alert_count} alert${validation.alert_count > 1 ? 's' : ''}` : `${validation.warning_count} warning${validation.warning_count > 1 ? 's' : ''}`;
  return (
    <Tooltip content={rules.map((r) => r.message).join(' · ')}>
      <span>
        <Badge tone={isAlert ? 'danger' : 'warning'} icon={isAlert ? <ShieldAlert size={12} /> : <AlertTriangle size={12} />}>
          {label}
        </Badge>
      </span>
    </Tooltip>
  );
}
