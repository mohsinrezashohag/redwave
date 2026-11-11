/**
 * RecentClawbacks — the rep's recent clawbacks (read-only). Date, reason, amount (mono money), and a
 * status badge (pending → warning, applied → neutral). Money is a display string formatted by money()
 * (no float math, #1). Empty state when there are none. Tokens only.
 */
import { Badge, Table, THead, TBody, TR, TH, TD, TableEmpty } from '../../../components/ui';
import { displayDate } from '../../../lib/format/date';
import { money } from '../../../lib/format/money';
import type { RepClawback } from '../dashboards.types';

export function RecentClawbacks({ rows }: { rows: RepClawback[] }) {
  if (rows.length === 0) {
    return <TableEmpty message="No clawbacks. Nothing has been recovered from your pay." />;
  }
  return (
    <Table density="comfortable">
      <THead>
        <TR>
          <TH>Date</TH>
          <TH>Reason</TH>
          <TH align="right">Amount</TH>
          <TH>Status</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((c) => (
          <TR key={c.id}>
            <TD>{displayDate(c.created_at)}</TD>
            <TD>{c.reason}</TD>
            <TD numeric>{money(c.amount)}</TD>
            <TD>
              <Badge tone={c.status === 'applied' ? 'neutral' : 'warning'}>
                {c.status === 'applied' ? 'Applied' : 'Pending'}
              </Badge>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
