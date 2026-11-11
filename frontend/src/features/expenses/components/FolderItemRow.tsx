/**
 * FolderItemRow — one collapsible item inside the folder workspace (report-as-folder, EXP-001). Collapsed by
 * default (a compact summary row, à la audit/HistoryTab); clicking expands ONE item inline into a read-only
 * detail with per-item actions: Edit (owner while unapproved / Admin·SA once approved — mirrors the server,
 * §5), Delete (owner/admin, unapproved), and Review (approver, when submitted/returned). Edit swaps the body
 * into the inline ExpenseForm. Tokens only.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge, Banner, Button, ConfirmDialog, useToast } from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { categoryLabel } from '../format';
import { useDeleteItem } from '../api/useExpenseMutations';
import { ExpenseStatusBadge } from './ExpenseStatusBadge';
import { ExpenseValidationBadge } from './ExpenseValidationBadge';
import { ReviewActions } from './ReviewActions';
import { ExpenseForm } from './ExpenseForm';
import styles from './expenses.module.css';
import type { ExpenseItem, FieldConfig, ReceiptUrl } from '../expenses.types';

export function FolderItemRow({
  item,
  configs,
  clientOptions,
  canReview,
  onChanged,
}: {
  item: ExpenseItem;
  configs: FieldConfig[];
  clientOptions: { value: string; label: string }[];
  canReview: boolean;
  onChanged: () => void;
}) {
  const { user, isSuperAdmin, roles } = useAuth();
  const canEditPerm = useCan('expenses:edit');
  const canDeletePerm = useCan('expenses:delete');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const del = useDeleteItem();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [openingReceipt, setOpeningReceipt] = useState(false);

  const isOwner = item.submitted_by === user?.id;
  const isAdmin = isSuperAdmin || roles.includes('Admin');
  const canEdit = item.status === 'approved' ? isAdmin : isOwner || canEditPerm;
  const canDelete = item.status !== 'approved' && (isOwner || canDeletePerm);
  const reviewable = canReview && (item.status === 'submitted' || item.status === 'sent_back');
  const km = item.km_log;
  const captured = (configs.find((c) => c.category_key === item.category)?.fields ?? []).filter((f) => item.field_values?.[f.key]);

  const openReceipt = async () => {
    if (openingReceipt) return;
    setOpeningReceipt(true);
    try {
      const { url } = await unwrap<ReceiptUrl>(api.GET('/v1/expense-items/{id}/receipt-url', { params: { path: { id: item.id } } }));
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      onError(err);
    } finally {
      setOpeningReceipt(false);
    }
  };

  const confirmDelete = () =>
    del.mutate(item.id, {
      onSuccess: () => {
        toast({ title: 'Expense deleted', tone: 'success' });
        setConfirmDel(false);
        onChanged();
      },
      onError: (e) => {
        onError(e);
        setConfirmDel(false);
      },
    });

  return (
    <li className={styles.itemRow}>
      <button type="button" className={styles.itemSummary} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className={styles.itemSummaryMain}>
          <span>
            <strong>{categoryLabel(item.category, configs)}</strong>
            {item.is_personal && <Badge tone="neutral">Personal</Badge>}
          </span>
          <span className={styles.itemSummaryMeta}>
            <span className="mono">{displayDate(item.expense_date)}</span>
            {item.description && <span>· {item.description}</span>}
          </span>
        </span>
        <ExpenseValidationBadge validation={item.validation} />
        <ExpenseStatusBadge status={item.status} />
        <strong className="mono">{money(item.amount, item.original_currency)}</strong>
      </button>

      {open && (
        <div className={styles.itemBody}>
          {editing ? (
            <ExpenseForm
              item={item}
              configs={configs}
              clientOptions={clientOptions}
              onSaved={() => {
                setEditing(false);
                onChanged();
              }}
            />
          ) : (
            <>
              {item.validation.alert_count > 0 && (
                <Banner tone="danger" title={`${item.validation.alert_count} alert(s) to fix`}>
                  <ul className={styles.warnList}>{item.validation.alerts.map((r) => <li key={r.code + (r.field ?? '')}>{r.message}</li>)}</ul>
                </Banner>
              )}
              {item.validation.warning_count > 0 && (
                <Banner tone="warning" title={`${item.validation.warning_count} warning(s)`}>
                  <ul className={styles.warnList}>{item.validation.warnings.map((r) => <li key={r.code + (r.field ?? '')}>{r.message}</li>)}</ul>
                </Banner>
              )}
              <dl className={styles.dl}>
                {item.original_currency !== 'CAD' && (
                  <>
                    <dt>CAD value</dt>
                    <dd className="mono">{item.amount_cad ? money(item.amount_cad) : 'Freezes at approval'}</dd>
                  </>
                )}
                {captured.map((f) => (
                  <span key={f.key} style={{ display: 'contents' }}>
                    <dt>{f.label}</dt>
                    <dd>{f.type === 'money' ? money(item.field_values?.[f.key]) : item.field_values?.[f.key]}</dd>
                  </span>
                ))}
                {km && (
                  <>
                    <dt>Kilometres</dt>
                    <dd className="mono">
                      {km.total_km} km − {km.deduction_km} = {km.billable_km} × ${km.rate_per_km} = {money(km.computed_amount)}
                    </dd>
                  </>
                )}
              </dl>
              <div className={styles.actions}>
                {!km && item.receipt_url && (
                  <Button variant="secondary" size="sm" loading={openingReceipt} onClick={() => void openReceipt()}>
                    View receipt
                  </Button>
                )}
                {canEdit && (
                  <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}
                {canDelete && (
                  <Button variant="tertiary" size="sm" onClick={() => setConfirmDel(true)}>
                    Delete
                  </Button>
                )}
                {reviewable && <ReviewActions item={item} onDone={onChanged} />}
              </div>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDel}
        onOpenChange={(o) => !o && setConfirmDel(false)}
        title="Delete expense item"
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={confirmDelete}
      >
        This permanently removes the item from the folder.
      </ConfirmDialog>
    </li>
  );
}
