/**
 * ValidationSummaryBanner — the aggregated Alert/Warning flag count over the current filter (EXP-013), the
 * INTERIM home for the report-header count until the report-as-folder rework lands. Renders nothing when the
 * set is clean. Danger tone when any alert is present, else warning. Reads the server's `validation-summary`.
 */
import { Banner } from '../../../components/ui';
import { useValidationSummary } from '../api/useExpenseItems';
import type { ExpenseFilters } from '../expenses.types';

export function ValidationSummaryBanner({ filters, enabled = true }: { filters: ExpenseFilters; enabled?: boolean }) {
  const q = useValidationSummary(filters, enabled);
  const s = q.data;
  if (!s || s.flagged === 0) return null;
  const parts: string[] = [];
  if (s.alert_items > 0) parts.push(`${s.alert_items} with alerts`);
  if (s.warning_items > 0) parts.push(`${s.warning_items} with warnings`);
  return (
    <Banner tone={s.alert_items > 0 ? 'danger' : 'warning'} title={`${s.flagged} of ${s.total} item(s) flagged`}>
      {parts.join(' · ')}. Open an item to see the details before approving.
    </Banner>
  );
}
