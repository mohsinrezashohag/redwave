/**
 * ReconciliationPage — /admin/reconciliation. Finance's integrity tie-out (read-only). Statement tie-out
 * (billing:view): the frozen statement total = Σ its lines = Σ the live re-priced sales (drift = stale).
 * Pay-run tie-out (payrun:view): each line's net = its components; run total = Σ net. Discrepancies are
 * flagged clearly. The server computes everything; this screen renders the verdict. — SRS §12
 */
import { useState } from 'react';
import { Banner, Badge, Card, FormField, PageHeader, Select, StatCard, Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useClients } from '../../clients/api/useClients';
import { usePayRuns, usePayPeriods } from '../../payrun/api/usePayRun';
import { useBillingPeriods } from '../../billing/api/useBilling';
import { useStatementTieOut, usePayRunTieOut } from '../api/useReconciliation';

function TieBadge({ ok }: { ok: boolean }) {
  return <Badge tone={ok ? 'success' : 'danger'}>{ok ? 'Ties out ✓' : 'Discrepancy'}</Badge>;
}

export default function ReconciliationPage() {
  const canBilling = useCan('billing:view');
  const canPayrun = useCan('payrun:view');

  const clientsQ = useClients('all', canBilling);
  // Statements bill by WEEK; pay runs are per pay period — two different calendars, two pickers.
  const billingPeriodsQ = useBillingPeriods(canBilling);
  const payPeriodsQ = usePayPeriods(canPayrun);
  const runsQ = usePayRuns(canPayrun);

  const [clientId, setClientId] = useState<string | undefined>();
  const [periodId, setPeriodId] = useState<string | undefined>();
  const [runId, setRunId] = useState<string | undefined>();

  const stmtTie = useStatementTieOut(clientId, periodId, canBilling);
  const runTie = usePayRunTieOut(runId, canPayrun);

  if (!canBilling || isForbidden(stmtTie.error)) {
    return <AccessDenied message="Reconciliation requires the billing view permission." />;
  }

  const periodNum = new Map((payPeriodsQ.data ?? []).map((p) => [p.id, p.period_number]));
  const clientOptions = (clientsQ.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.client_code})` }));
  const periodOptions = (billingPeriodsQ.data ?? []).map((p) => ({ value: p.id, label: `Bill ${p.period_number} · ${displayDate(p.start_date)}–${displayDate(p.end_date)}` }));
  const runOptions = (runsQ.data ?? []).map((r) => ({ value: r.id, label: `Period #${periodNum.get(r.pay_period_id) ?? '—'} · ${r.status}` }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader
        title="Reconciliation"
        subtitle="Tie statements to their sales and pay runs to their lines (CAD). Any mismatch is flagged — the integrity safety net."
      />

      {/* ── Statement tie-out ─────────────────────────────────────────────── */}
      <Card title="Statement tie-out">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-3)' }}>
          <FormField label="Client">
            <Select placeholder="Select a client" options={clientOptions} value={clientId} onValueChange={setClientId} />
          </FormField>
          <FormField label="Billing week">
            <Select placeholder="Select a period" options={periodOptions} value={periodId} onValueChange={setPeriodId} />
          </FormField>
        </div>

        {clientId && periodId && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <DataState isLoading={stmtTie.isLoading} isError={stmtTie.isError} onRetry={() => stmtTie.refetch()}>
              {stmtTie.data && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                    <TieBadge ok={stmtTie.data.ok} />
                    {stmtTie.data.statement && <span className="mono" style={{ color: 'var(--text-secondary)' }}>STMT-{String(stmtTie.data.statement.statement_number ?? 0).padStart(5, '0')}</span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
                    <StatCard label="Statement total" value={money(stmtTie.data.frozen_total)} />
                    <StatCard label="Sum of lines" value={money(stmtTie.data.lines_sum)} />
                    <StatCard label="Live re-price" value={stmtTie.data.live_total === null ? '—' : money(stmtTie.data.live_total)} />
                  </div>
                  {stmtTie.data.discrepancies.length > 0 && (
                    <Banner tone="danger" title="Discrepancies">
                      <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
                        {stmtTie.data.discrepancies.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </Banner>
                  )}
                </>
              )}
            </DataState>
          </div>
        )}
      </Card>

      {/* ── Pay-run tie-out ───────────────────────────────────────────────── */}
      {canPayrun && (
        <Card title="Pay-run tie-out">
          <FormField label="Pay run">
            <Select placeholder="Select a pay run" options={runOptions} value={runId} onValueChange={setRunId} />
          </FormField>

          {runId && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <DataState isLoading={runTie.isLoading} isError={runTie.isError} onRetry={() => runTie.refetch()}>
                {runTie.data && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                      <TieBadge ok={runTie.data.ok} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
                      <StatCard label="Run total (Σ net)" value={money(runTie.data.run_total)} />
                      <StatCard label="Lines" value={String(runTie.data.line_count)} />
                    </div>
                    {runTie.data.discrepancies.length > 0 ? (
                      <Table>
                        <THead>
                          <TR>
                            <TH>Rep</TH>
                            <TH align="right">Stored net</TH>
                            <TH align="right">Recomputed net</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {runTie.data.discrepancies.map((l) => (
                            <TR key={l.rep_id}>
                              <TD><span className="mono">{l.rep_code ?? l.rep_id.slice(0, 8)}</span></TD>
                              <TD numeric>{money(l.stored_net)}</TD>
                              <TD numeric>{money(l.recomputed_net)}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    ) : (
                      <p className="mono" style={{ color: 'var(--text-secondary)' }}>Every line’s net matches its components.</p>
                    )}
                  </>
                )}
              </DataState>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
