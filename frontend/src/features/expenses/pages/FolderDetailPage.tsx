/**
 * FolderDetailPage — the report-folder WORKSPACE (report-as-folder, EXP-001). Header = the folder name/period,
 * its DERIVED status, the aggregated Alert/Warning banner, and folder-level actions (Submit [owner]; Approve-
 * all/Return-all/Reject-all [approver]; Rename; Delete). Below: the folder's items as collapsible rows +
 * an inline "Add expense" control (stays open for fast multi-add). All actions exist BOTH at folder level and
 * per item (req #2). The UI computes nothing; the server is the real gate (§5). Tokens only.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Banner, Button, Card, ConfirmDialog, Input, Modal, PageHeader, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { isForbidden, isNotFound, useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useFieldConfigs } from '../api/useExpenseItems';
import { useExpenseReport } from '../api/useExpenseReports';
import { useClients } from '../api/useLookups';
import { useDeleteReport, useReviewReport, useSubmitReport, useUpdateReport } from '../api/useExpenseMutations';
import { FolderStatusBadge } from '../components/FolderStatusBadge';
import { FolderItemRow } from '../components/FolderItemRow';
import { InlineAddItem } from '../components/InlineAddItem';
import styles from '../components/expenses.module.css';

export default function FolderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canView = useCan('expenses:view');
  const canReview = useCan('expenses:approve');
  const canEdit = useCan('expenses:edit');
  const canViewClients = useCan('clients:view');
  const { toast } = useToast();
  const onError = useApiErrorToast();

  const q = useExpenseReport(id, canView);
  const configs = useFieldConfigs(canView);
  const clients = useClients(canView && canViewClients);
  const submit = useSubmitReport();
  const review = useReviewReport();
  const rename = useUpdateReport();
  const del = useDeleteReport();

  const [addKey, setAddKey] = useState(0); // remount InlineAddItem to reset after each add
  const [adding, setAdding] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  if (!canView || isForbidden(q.error)) return <AccessDenied message="Viewing expenses requires the expenses view permission." />;

  const folder = q.data;
  const clientOptions = (clients.data ?? []).map((c) => ({ value: c.id, label: c.name }));
  const items = folder?.items ?? [];
  const isOwner = !!folder && folder.submitted_by === user?.id;
  const canManage = isOwner || canEdit;
  const refetch = () => void q.refetch();
  const run = (p: Promise<unknown>, ok: string) => p.then(() => { toast({ title: ok, tone: 'success' }); }).catch(onError);

  return (
    <div className={styles.page}>
      {isNotFound(q.error) ? (
        <>
          <PageHeader title="Expense report" />
          <Card>This report doesn’t exist or isn’t visible to you.</Card>
        </>
      ) : (
        <DataState isLoading={q.isLoading} isError={q.isError && !isNotFound(q.error)} isEmpty={false} onRetry={refetch}>
          {folder && (
            <>
              <PageHeader
                title={
                  <span className={styles.folderHead}>
                    {folder.name} <FolderStatusBadge status={folder.status} />
                  </span>
                }
                subtitle={`${displayDate(folder.week_start)} – ${displayDate(folder.week_end)} · ${folder.item_count} item(s) · ${money(folder.total_reimbursable_cad)} reimbursable`}
                actions={
                  <div className={styles.folderActions}>
                    <Button variant="tertiary" onClick={() => navigate('/expenses')}>Back</Button>
                    {canManage && (folder.status === 'draft' || folder.status === 'needs_attention') && folder.item_count > 0 && (
                      <Button variant="primary" loading={submit.isPending} onClick={() => run(submit.mutateAsync(folder.id), 'Folder submitted')}>
                        Submit folder
                      </Button>
                    )}
                    {canReview && folder.status === 'pending' && (
                      <>
                        <Button variant="primary" loading={review.isPending} onClick={() => run(review.mutateAsync({ id: folder.id, body: { decision: 'approve' } }), 'Folder approved')}>
                          Approve all
                        </Button>
                        <Button variant="secondary" loading={review.isPending} onClick={() => run(review.mutateAsync({ id: folder.id, body: { decision: 'send_back' } }), 'Folder returned')}>
                          Send all back
                        </Button>
                        <Button variant="secondary" loading={review.isPending} onClick={() => run(review.mutateAsync({ id: folder.id, body: { decision: 'reject' } }), 'Folder rejected')}>
                          Reject all
                        </Button>
                      </>
                    )}
                    {canManage && (
                      <Button variant="secondary" onClick={() => { setRenameVal(folder.name); setRenameOpen(true); }}>Rename</Button>
                    )}
                    {canManage && <Button variant="tertiary" onClick={() => setConfirmDel(true)}>Delete</Button>}
                  </div>
                }
              />

              {folder.validation.flagged > 0 && (
                <Banner tone={folder.validation.alert_count > 0 ? 'danger' : 'warning'} title={`${folder.validation.flagged} flagged item(s)`}>
                  {folder.validation.alert_count > 0 && `${folder.validation.alert_count} alert(s) `}
                  {folder.validation.warning_count > 0 && `${folder.validation.warning_count} warning(s)`}. Expand an item to see the details.
                </Banner>
              )}

              <Card title="Items" flush>
                {items.length === 0 ? (
                  <p className="mono" style={{ padding: 'var(--space-4)' }}>No items yet. Add your first expense below.</p>
                ) : (
                  <ol className={styles.itemList} style={{ padding: 'var(--space-4)' }}>
                    {items.map((it) => (
                      <FolderItemRow key={it.id} item={it} configs={configs.data ?? []} clientOptions={clientOptions} canReview={canReview} onChanged={refetch} />
                    ))}
                  </ol>
                )}
              </Card>

              {/* Add-expense control — stays open after each add for fast multi-entry (req #3). */}
              {canManage &&
                (adding ? (
                  <Card title="New expense">
                    <InlineAddItem
                      key={addKey}
                      reportId={folder.id}
                      configs={configs.data ?? []}
                      clientOptions={clientOptions}
                      onDone={() => { refetch(); setAddKey((k) => k + 1); }}
                      onCancel={() => setAdding(false)}
                    />
                  </Card>
                ) : (
                  <Button className={styles.addExpenseBtn} variant="secondary" leftIcon={<Plus size={16} />} onClick={() => setAdding(true)}>
                    Add expense
                  </Button>
                ))}

              <Modal
                open={renameOpen}
                onOpenChange={(o) => !o && setRenameOpen(false)}
                title="Rename report"
                footer={
                  <div className={styles.footer}>
                    <Button variant="secondary" onClick={() => setRenameOpen(false)}>Cancel</Button>
                    <Button
                      variant="primary"
                      loading={rename.isPending}
                      onClick={() =>
                        rename.mutate(
                          { id: folder.id, body: { name: renameVal.trim() || folder.name } },
                          { onSuccess: () => { toast({ title: 'Renamed', tone: 'success' }); setRenameOpen(false); }, onError },
                        )
                      }
                    >
                      Save
                    </Button>
                  </div>
                }
              >
                <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} placeholder="Report name" />
              </Modal>

              <ConfirmDialog
                open={confirmDel}
                onOpenChange={(o) => !o && setConfirmDel(false)}
                title="Delete this report?"
                description="This removes the folder and its unapproved items. A folder with an approved item can't be deleted."
                confirmLabel="Delete report"
                loading={del.isPending}
                onConfirm={() =>
                  del.mutate(folder.id, {
                    onSuccess: () => { toast({ title: 'Report deleted', tone: 'success' }); setConfirmDel(false); navigate('/expenses'); },
                    onError: (e) => { onError(e); setConfirmDel(false); },
                  })
                }
              />
            </>
          )}
        </DataState>
      )}
    </div>
  );
}
