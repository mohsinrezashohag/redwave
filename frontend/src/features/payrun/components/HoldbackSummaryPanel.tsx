/**
 * HoldbackSummaryPanel — the run's period-level 30% (deferred pay) overview: what is held THIS period,
 * WHEN it releases, what matured into this period, the clawback set-off, and the still-outstanding total,
 * plus a per-origin-period breakdown read from the holdback ledger.
 *
 * EVERY figure comes from `GET /v1/pay-runs/:id/holdback` already computed — this component performs NO
 * aggregation and NO money math (#1). On a draft the current hold + its release period are a projection
 * (`is_projection`), because nothing is written to the ledger until finalize. — SRS §9 / §17.1
 */
import { Badge, Banner, Card, StatCard, Table, TBody, TD, TH, THead, TR, type BadgeTone } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { money } from '../../../lib/format/money';
import { useHoldbackSummary } from '../api/usePayRun';
import styles from './payrun.module.css';
import type { HoldbackPeriodRef, HoldbackReleaseStatus } from '../payrun.types';

const RELEASE_TONE: Record<HoldbackReleaseStatus, BadgeTone> = {
  held: 'neutral',
  scheduled: 'info',
  released: 'success',
};

const periodLabel = (p: HoldbackPeriodRef | null) => (p ? `#${p.period_number}` : '—');

export function HoldbackSummaryPanel({ runId }: { runId: string }) {
  const q = useHoldbackSummary(runId);
  const s = q.data;

  return (
    <Card title="30% holdback (deferred pay)">
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={!s}
        onRetry={() => q.refetch()}
        emptyNode={<p className="mono">No holdback figures for this run.</p>}
      >
        {s && (
          <>
            {s.is_projection && (
              <Banner tone="info">
                Draft — the 30% held below is a projection. It is written to the holdback ledger when the run
                is finalized.
              </Banner>
            )}

            <div className={styles.summary}>
              <StatCard
                label="Held this period (30%)"
                value={money(s.held_this_period)}
                footnote={
                  s.held_release_period
                    ? `Releases into period ${periodLabel(s.held_release_period)}`
                    : 'No release period scheduled'
                }
              />
              <StatCard label="Releasing this period" value={money(s.releasing_this_period)} />
              <StatCard label="Clawback set-off" value={money(s.clawback_setoff_this_period)} />
              <StatCard
                label="Still outstanding"
                value={money(s.outstanding_total)}
                footnote="Held but not yet released"
              />
            </div>

            <h3 className={styles.sectionTitle}>By origin period</h3>
            {s.by_origin.length === 0 ? (
              <p className="mono">Nothing held yet for this run&rsquo;s reps.</p>
            ) : (
              <Table density="dense">
                <THead>
                  <TR>
                    <TH>Origin</TH>
                    <TH align="right">Held</TH>
                    <TH>Releases into</TH>
                    <TH>Status</TH>
                    <TH align="right">Set-off</TH>
                    <TH align="right">Released</TH>
                  </TR>
                </THead>
                <TBody>
                  {s.by_origin.map((o) => (
                    <TR key={o.origin_period?.id ?? periodLabel(o.origin_period)}>
                      <TD>
                        <span className="mono">{periodLabel(o.origin_period)}</span>
                      </TD>
                      <TD numeric>{money(o.amount_held)}</TD>
                      <TD>
                        <span className="mono">{periodLabel(o.scheduled_release_period)}</span>
                      </TD>
                      <TD>
                        <Badge tone={RELEASE_TONE[o.release_status]}>{o.release_status}</Badge>
                      </TD>
                      <TD numeric>{o.clawback_applied ? money(o.clawback_applied) : '—'}</TD>
                      <TD numeric>{money(o.amount_released)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </DataState>
    </Card>
  );
}
