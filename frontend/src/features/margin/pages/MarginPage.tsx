/**
 * MarginPage — /reports/margin. What the client was billed, what the rep was paid, and the spread.
 *
 * The spread IS Redwave's earning, and until now it existed nowhere: not a column, not a screen. The
 * business dashboard's `net_margin` is a CASH margin (revenue − net payout, after expenses, bonuses,
 * released holdback and clawbacks), which with the 30% holdback is not what was earned in the period.
 * This is per-sale product margin.
 *
 * Super Admin only — the server is the real gate and a 403 renders AccessDenied (§5). The UI computes
 * NOTHING: every amount and every percentage is the server's (#1), and no currency is ever converted —
 * rows and totals carry their own (#12).
 *
 * Two honest limitations are stated on screen rather than left to be discovered:
 *   - a sale billed but not yet paid shows zero rep cost, so its margin is not final;
 *   - a pay period and a billing week never align, so period totals will not tie out exactly.
 */
import { useState } from 'react';
import {
  Badge,
  Banner,
  DatePicker,
  Card,
  PageHeader,
  SegmentedControl,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { ExportMenu } from '../../../components/data/ExportMenu';
import type { ExportColumn } from '../../../lib/export/exportRows';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { displayDate, todayIso } from '../../../lib/format/date';
import { exportFilename } from '../../../lib/export/exportFilename';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useClients } from '../../clients/api/useClients';
import { useMarginPerSale, useMarginRollup } from '../api/useMargin';
import type { MarginGroup, MarginRow, RollupDimension } from '../margin.types';
import styles from '../components/margin.module.css';

const SCOPE_ALL = '__all__';

/** A margin cell: negative is shown with its sign and danger colour, never hidden or floored (§13.6). */
function MarginCell({ value, currency }: { value: string; currency: string }) {
  const negative = value.trim().startsWith('-');
  return (
    <span className={negative ? styles.negative : undefined}>{money(value, currency)}</span>
  );
}

export default function MarginPage() {
  const canView = useCan('reports:business');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayIso());
  const [by, setBy] = useState<RollupDimension>('product');
  const [clientId, setClientId] = useState<string>(SCOPE_ALL);

  const scoped = clientId === SCOPE_ALL ? undefined : clientId;
  const clients = useClients('all', canView);
  const perSale = useMarginPerSale(from, to, scoped, canView && !!from);
  const rollup = useMarginRollup(from, to, by, scoped, canView && !!from);

  if (!canView || isForbidden(perSale.error)) return <AccessDenied />;

  const rows = perSale.data ?? [];
  const groups = rollup.data ?? [];

  const exportColumns: ExportColumn<MarginRow>[] = [
    { header: 'Sale date', value: (r) => (r.sale_date ? displayDate(r.sale_date) : '') },
    { header: 'Client', value: (r) => r.client_code ?? '' },
    { header: 'Customer', value: (r) => r.customer_name },
    { header: 'Product', value: (r) => r.product_name ?? '' },
    { header: 'Rep', value: (r) => r.rep_name ?? r.rep_code ?? '' },
    { header: 'Currency', value: (r) => r.currency },
    { header: 'Client billed', value: (r) => r.client_billed },
    { header: 'Rep paid', value: (r) => r.rep_paid },
    { header: 'Margin', value: (r) => r.margin },
    { header: 'Margin %', value: (r) => r.margin_pct ?? '' },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Margin"
        subtitle="What each sale earned: the client bill, the rep pay, and the spread between them."
        actions={
          rows.length > 0 ? (
            <ExportMenu
              filename={exportFilename({ source: 'margin', period: { from, to }, generatedOn: todayIso() })}
              title="Margin"
              columns={exportColumns}
              getRows={() => Promise.resolve(rows)}
            />
          ) : undefined
        }
      />

      <Card title="Range">
        <div className={styles.controls}>
          <DatePicker value={from} onChange={setFrom} aria-label="From" />
          <DatePicker value={to} onChange={setTo} aria-label="To" />
          <Select
            aria-label="Client"
            value={clientId}
            onValueChange={setClientId}
            options={[
              { value: SCOPE_ALL, label: 'All clients' },
              ...(clients.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.client_code})` })),
            ]}
          />
        </div>
        {!from && <p className={styles.note}>Pick a start date to load margin.</p>}
      </Card>

      {from && (
        <>
          <Card
            title="By"
            actions={
              <SegmentedControl
                value={by}
                onChange={(v) => setBy(v as RollupDimension)}
                options={[
                  { value: 'product', label: 'Product' },
                  { value: 'client', label: 'Client' },
                  { value: 'rep', label: 'Rep' },
                ]}
              />
            }
          >
            <DataState
              isLoading={rollup.isLoading}
              isError={rollup.isError}
              isEmpty={groups.length === 0}
              onRetry={() => rollup.refetch()}
              emptyNode={<p className={styles.note}>No issued statements in this range.</p>}
            >
              <Table>
                <THead>
                  <TR>
                    <TH>{by === 'product' ? 'Product' : by === 'client' ? 'Client' : 'Rep'}</TH>
                    <TH align="right">Sales</TH>
                    <TH align="right">Client billed</TH>
                    <TH align="right">Rep paid</TH>
                    <TH align="right">Margin</TH>
                    <TH align="right">Margin %</TH>
                  </TR>
                </THead>
                <TBody>
                  {groups.map((g: MarginGroup) => (
                    <TR key={g.key}>
                      <TD>
                        {g.label}{' '}
                        {g.currency !== 'CAD' && <Badge tone="neutral">{g.currency}</Badge>}
                      </TD>
                      <TD numeric>{g.sale_count}</TD>
                      <TD numeric>{money(g.client_billed, g.currency)}</TD>
                      <TD numeric>{money(g.rep_paid, g.currency)}</TD>
                      <TD numeric>
                        <MarginCell value={g.margin} currency={g.currency} />
                      </TD>
                      <TD numeric>{g.margin_pct === null ? '—' : `${g.margin_pct}%`}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <p className={styles.note}>
                Groups are kept separate per currency — amounts in different currencies are never added
                together.
              </p>
            </DataState>
          </Card>

          <Card title="Per sale">
            <DataState
              isLoading={perSale.isLoading}
              isError={perSale.isError}
              isEmpty={rows.length === 0}
              onRetry={() => perSale.refetch()}
              emptyNode={<p className={styles.note}>No issued statements in this range.</p>}
            >
              <Table maxHeight="60vh">
                <THead>
                  <TR>
                    <TH>Sale date</TH>
                    <TH>Client</TH>
                    <TH>Customer</TH>
                    <TH>Product</TH>
                    <TH>Rep</TH>
                    <TH align="right">Client billed</TH>
                    <TH align="right">Rep paid</TH>
                    <TH align="right">Margin</TH>
                    <TH align="right">%</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.sale_id}>
                      <TD>{r.sale_date ? displayDate(r.sale_date) : '—'}</TD>
                      <TD>{r.client_code ?? '—'}</TD>
                      <TD>{r.customer_name}</TD>
                      <TD>{r.product_name ?? '—'}</TD>
                      <TD>{r.rep_name ?? r.rep_code ?? '—'}</TD>
                      <TD numeric>{money(r.client_billed, r.currency)}</TD>
                      <TD numeric>
                        {r.rep_paid === '0.00' ? (
                          <span className={styles.subtle} title="Billed, but this sale has not been through a finalized pay run yet">
                            not yet paid
                          </span>
                        ) : (
                          money(r.rep_paid, r.currency)
                        )}
                      </TD>
                      <TD numeric>
                        <MarginCell value={r.margin} currency={r.currency} />
                      </TD>
                      <TD numeric>{r.margin_pct === null ? '—' : `${r.margin_pct}%`}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </DataState>
          </Card>

          <Banner tone="info" title="Why a period will never tie out exactly">
            A pay period closes on a Saturday; its second billing week closes the following Sunday. One day
            of revenue always falls outside the matching payout window, so margin for a period is
            approximate by nature. A sale marked <em>not yet paid</em> has been billed but has not been
            through a finalized pay run, so its margin is not final either.
          </Banner>
        </>
      )}
    </div>
  );
}
