/**
 * LineBreakdownDrawer — one rep in a commission report: the SERVER's line as a labelled waterfall
 * (commission + incentives + expenses + bonus = net), then the per-sale drill-down from
 * GET /v1/pay-runs/:id/reps/:repId/sales. The +/= glyphs are presentation ONLY, and the sale and item totals
 * are the server's strings: nothing is computed here (#1/#5).
 *
 * A PAID report shows the frozen snapshots (#2); a DRAFT shows the rate in force on each sale date, labelled
 * as an estimate. Clawbacks are hidden since 2026-11-16 (no deduction is applied).
 */
import { Badge, Drawer, Table, TableError, TableSkeleton, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { useRunSales } from '../api/usePayRun';
import { NetPayoutCell } from './NetPayoutCell';
import styles from './payrun.module.css';
import type { PayRunLine } from '../payrun.types';

function Row({ op, label, value }: { op: string; label: string; value: string | null }) {
  return (
    <div className={styles.bdRow}>
      <span className={styles.bdOp}>{op}</span>
      <span className={styles.bdLabel}>{label}</span>
      <span className={styles.bdValue}>{money(value)}</span>
    </div>
  );
}

interface Props {
  runId: string;
  line: PayRunLine | null;
  open: boolean;
  onClose: () => void;
}

export function LineBreakdownDrawer({ runId, line, open, onClose }: Props) {
  const salesQ = useRunSales(runId, line?.rep.id, open && !!line);
  const data = salesQ.data;

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={line ? `${line.rep.full_name} · ${line.rep.rep_code}` : 'Rep'}
      size="wide"
    >
      {line && (
        <div className={styles.statement}>
          <div className={styles.breakdown}>
            <Row op="" label="Commission" value={line.commission} />
            <Row op="+" label="Incentives" value={line.incentive_total} />
            <Row op="+" label="Expenses" value={line.expense_total} />
            <Row op="+" label="Bonus" value={line.bonus_amount} />
            <div className={`${styles.bdRow} ${styles.bdTotal}`}>
              <span className={styles.bdOp}>=</span>
              <span className={styles.bdLabel}>Net payout</span>
              <span className={styles.bdValue}>
                <NetPayoutCell value={line.net_payout} />
              </span>
            </div>
          </div>
          {line.bonus_note && (
            <p className={styles.note}>
              Bonus note: <em>{line.bonus_note}</em>
            </p>
          )}

          <h3 className={styles.sectionTitle}>Sales</h3>
          {salesQ.isLoading && <TableSkeleton rows={4} columns={4} />}
          {salesQ.isError && <TableError message="Couldn't load this rep's sales." onRetry={() => salesQ.refetch()} />}
          {data && (
            <>
              <p className={styles.basis}>
                {data.basis === 'paid'
                  ? 'Paid amounts. Each item shows the rate frozen when the report was marked as paid.'
                  : 'Estimated amounts. Each item shows the rep rate in force on its sale date. They are frozen when the report is marked as paid.'}
              </p>
              {data.sales.length === 0 ? (
                <p className={styles.note}>No sales for this rep in this report.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Sale</TH>
                      <TH>Customer</TH>
                      <TH>Items</TH>
                      <TH align="right">Earned</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.sales.map((s) => (
                      <TR key={s.sale_id}>
                        <TD>
                          <span className={`mono ${styles.nowrap}`}>{s.sale_code}</span>
                          <span className={styles.subline}>
                            {displayDate(s.sale_date)} · {s.client_code}
                          </span>
                        </TD>
                        <TD>{s.customer_name}</TD>
                        <TD>
                          <ul className={styles.itemList}>
                            {s.items.map((i) => (
                              <li key={i.id}>
                                <span>{i.product_name ?? productTypeLabel(i.product_type)}</span>
                                <span className="mono">{money(i.commission_paid)}</span>
                                {i.incentive_amount !== '0.00' && (
                                  <Badge tone="accent">Incentive {money(i.incentive_amount)}</Badge>
                                )}
                              </li>
                            ))}
                          </ul>
                        </TD>
                        <TD numeric>{money(s.total)}</TD>
                      </TR>
                    ))}
                    <TR>
                      <TD colSpan={3}>
                        <strong>Total · {data.sales.length} sales</strong>
                      </TD>
                      <TD numeric>
                        <strong>{money(data.total)}</strong>
                      </TD>
                    </TR>
                  </TBody>
                </Table>
              )}
            </>
          )}
          <p className={styles.footnote}>Every amount here comes from the server. Nothing is calculated on this screen.</p>
        </div>
      )}
    </Drawer>
  );
}
