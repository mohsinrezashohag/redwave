/**
 * ExpenseDetailPage — view ONE expense item + the SERVER-computed km breakdown + status (item-first).
 * Actions are gated: Edit shows pre-approval (expenses:edit) or post-approval (Super Admin only — EXP-007);
 * Review (Approve/Reject/Send-back) shows for an approver while the item is submitted/sent_back. The server
 * is the real gate.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, PageHeader } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import type { ReceiptUrl } from '../expenses.types';
import { displayDate } from '../../../lib/format/date';
import { money } from '../../../lib/format/money';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useExpenseItem, useFieldConfigs } from '../api/useExpenseItems';
import { useClients, useReps } from '../api/useLookups';
import { categoryLabel } from '../format';
import { ExpenseStatusBadge } from '../components/ExpenseStatusBadge';
import { ReviewActions } from '../components/ReviewActions';
import styles from '../components/expenses.module.css';

const REVIEWABLE = new Set(['submitted', 'sent_back']);

/** True when a thrown query error is a server 404 (a not-visible / missing item). */
const isNotFound = (error: unknown): boolean =>
  !!error && typeof error === 'object' && 'status' in error && (error as { status: unknown }).status === 404;

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const canEdit = useCan('expenses:edit');
  const canApprove = useCan('expenses:approve');
  const canViewReps = useCan('hrm:view');
  const canViewClients = useCan('clients:view');

  const q = useExpenseItem(id);
  const configs = useFieldConfigs();
  const reps = useReps(canViewReps);
  const clients = useClients(canViewClients);
  const [openingReceipt, setOpeningReceipt] = useState(false);
  const onReceiptError = useApiErrorToast('Couldn’t open the receipt. Please try again.');

  // A fresh 60s signed URL is minted per view (the path itself is never a viewable URL). — security.md
  const openReceipt = async () => {
    if (!id || openingReceipt) return;
    setOpeningReceipt(true);
    try {
      const { url } = await unwrap<ReceiptUrl>(
        api.GET('/v1/expense-items/{id}/receipt-url', { params: { path: { id } } }),
      );
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      onReceiptError(err);
    } finally {
      setOpeningReceipt(false);
    }
  };

  if (isForbidden(q.error)) return <AccessDenied message="You don’t have access to this expense item." />;

  const item = q.data;
  const repName = (rid: string | null) => (rid ? reps.data?.find((r) => r.id === rid)?.full_name ?? rid.slice(0, 8) : '—');
  const clientName = (cid: string | null) => (cid ? clients.data?.find((c) => c.id === cid)?.name ?? '—' : '—');

  const editable = item ? (item.status === 'approved' ? isSuperAdmin : canEdit) : false;
  const reviewable = !!item && canApprove && REVIEWABLE.has(item.status);
  const km = item?.km_log ?? null;

  return (
    <div className={styles.page}>
      <PageHeader title="Expense item" />
      {isNotFound(q.error) ? (
        <Card>This expense item doesn’t exist or isn’t visible to you.</Card>
      ) : (
        <DataState isLoading={q.isLoading} isError={q.isError && !isNotFound(q.error)} isEmpty={false} onRetry={() => q.refetch()}>
          {item && (
            <>
              <Card title="Details">
                <div className={styles.detailHead}>
                  <ExpenseStatusBadge status={item.status} />
                  <strong className="mono">{money(item.amount, item.original_currency)}</strong>
                </div>
                <dl className={styles.dl} style={{ marginTop: 'var(--space-3)' }}>
                  <dt>Category</dt>
                  <dd>{categoryLabel(item.category, configs.data)}</dd>
                  {item.original_currency !== 'CAD' && (
                    <>
                      <dt>CAD value</dt>
                      <dd className="mono">
                        {item.amount_cad ? `${money(item.amount_cad)} (rate ${item.fx_rate})` : 'Will freeze at approval'}
                      </dd>
                    </>
                  )}
                  <dt>Date</dt>
                  <dd className="mono">{displayDate(item.expense_date)}</dd>
                  <dt>Description</dt>
                  <dd>{item.description}</dd>
                  {item.tags && item.tags.length > 0 && (
                    <>
                      <dt>Tags</dt>
                      <dd className={styles.tagList}>
                        {item.tags.map((t) => (
                          <Badge key={t} tone="info">
                            {t}
                          </Badge>
                        ))}
                      </dd>
                    </>
                  )}
                  {item.is_personal && (
                    <>
                      <dt>Personal</dt>
                      <dd>
                        <Badge tone="neutral">Do not reimburse</Badge>
                      </dd>
                    </>
                  )}
                  {canViewReps && (
                    <>
                      <dt>Rep</dt>
                      <dd>{repName(item.rep_id)}</dd>
                    </>
                  )}
                  {canViewClients && (
                    <>
                      <dt>Client</dt>
                      <dd>{clientName(item.client_id)}</dd>
                    </>
                  )}
                  <dt>Pay period</dt>
                  <dd>{item.pay_period_id ? 'Assigned (by expense date)' : '—'}</dd>
                  {!km && (
                    <>
                      <dt>Receipt</dt>
                      <dd>
                        {item.receipt_url ? (
                          <Button variant="secondary" size="sm" loading={openingReceipt} onClick={() => void openReceipt()}>
                            View receipt
                          </Button>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </>
                  )}
                  <dt>Submitted</dt>
                  <dd className="mono">{displayDate(item.created_at)}</dd>
                  {item.approved_at && (
                    <>
                      <dt>Approved</dt>
                      <dd className="mono">{displayDate(item.approved_at)}</dd>
                    </>
                  )}
                </dl>
              </Card>

              {km && (
                <Card title="Kilometre details (server-computed)">
                  <div className={styles.kmBreakdown}>
                    <span>{km.trip_type === 'round' ? 'Round' : 'Single'} trip</span>
                    <span>Total <strong className="mono">{km.total_km}</strong> km</span>
                    <span>− deduction <strong className="mono">{km.deduction_km}</strong> km</span>
                    <span>= billable <strong className="mono">{km.billable_km}</strong> km</span>
                    <span>× <strong className="mono">${km.rate_per_km}</strong>/km</span>
                    <span>= <strong className="mono">{money(km.computed_amount)}</strong></span>
                  </div>
                  <ol className={styles.stopList}>
                    {km.stops.map((s) => (
                      <li key={s.id}>{s.address}</li>
                    ))}
                  </ol>
                </Card>
              )}

              <div className={styles.actions}>
                {editable && (
                  <Button variant="secondary" onClick={() => navigate(`/expenses/${item.id}/edit`)}>
                    Edit
                  </Button>
                )}
                {reviewable && <ReviewActions item={item} onDone={() => q.refetch()} />}
                <Button variant="tertiary" onClick={() => navigate('/expenses')}>
                  Back to expenses
                </Button>
              </div>
            </>
          )}
        </DataState>
      )}
    </div>
  );
}
