/**
 * HoldbackPanel — read-only holdback ledger for the reps on this run (held vs released, release status).
 * Rep names are joined from the run's own lines and period labels from the schedule; the ledger returns
 * raw IDs (no money math here, just label lookups). Scoped server-side to the caller's reps. — SRS §9
 */
import { Badge, Card, Table, TBody, TD, TH, THead, TR, type BadgeTone } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { money } from '../../../lib/format/money';
import { useHoldbackLedger } from '../api/usePayRun';
import type { HoldbackReleaseStatus, PayPeriod, PayRunLine } from '../payrun.types';

const RELEASE_TONE: Record<HoldbackReleaseStatus, BadgeTone> = {
  held: 'neutral',
  scheduled: 'info',
  released: 'success',
};

export function HoldbackPanel({ lines, periods }: { lines: PayRunLine[]; periods: PayPeriod[] }) {
  const ledger = useHoldbackLedger();
  const repIds = new Set(lines.map((l) => l.rep_id));
  const repLabel = (id: string) => {
    const line = lines.find((l) => l.rep_id === id);
    return line ? `${line.rep.rep_code} · ${line.rep.full_name}` : id;
  };
  const periodLabel = (id: string | null) => {
    if (!id) return '—';
    const p = periods.find((x) => x.id === id);
    return p ? `#${p.period_number}` : '—';
  };
  const rows = (ledger.data ?? []).filter((h) => repIds.has(h.rep_id));

  return (
    <Card title="Holdback ledger">
      <DataState
        isLoading={ledger.isLoading}
        isError={ledger.isError}
        isEmpty={rows.length === 0}
        onRetry={() => ledger.refetch()}
        emptyNode={<p className="mono">No holdback records for this run&rsquo;s reps yet (the 30% is recorded at finalize).</p>}
      >
        <Table density="dense">
          <THead>
            <TR>
              <TH>Rep</TH>
              <TH align="right">Held</TH>
              <TH>Origin</TH>
              <TH>Releases into</TH>
              <TH>Status</TH>
              <TH align="right">Clawback set-off</TH>
              <TH align="right">Released</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((h) => (
              <TR key={h.id}>
                <TD>{repLabel(h.rep_id)}</TD>
                <TD numeric>{money(h.amount_held)}</TD>
                <TD>
                  <span className="mono">{periodLabel(h.origin_pay_period_id)}</span>
                </TD>
                <TD>
                  <span className="mono">{periodLabel(h.scheduled_release_period_id)}</span>
                </TD>
                <TD>
                  <Badge tone={RELEASE_TONE[h.release_status]}>{h.release_status}</Badge>
                </TD>
                <TD numeric>{h.clawback_applied ? money(h.clawback_applied) : '—'}</TD>
                <TD numeric>{money(h.amount_released)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </DataState>
    </Card>
  );
}
