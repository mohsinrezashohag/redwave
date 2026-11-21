/**
 * SaleDetailView — the deep-linkable detail pattern (route `/sales/:id`, not a drawer). Shows the
 * composite Sale ID, lifecycle status, customer + address, derived pay period (null → "Not assigned"),
 * and the line items (product type + whether it is greenfield). The permitted actions are gated by `useCan`
 * AND the §16 lifecycle status — convenience only; the server is the real gate (CLAUDE §5). — SALE-004
 */
import { Check, Pencil, Sprout, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banner,
  Button,
  Card,
  Modal,
  StatusPill,
  Tooltip,
  useToast,
} from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast, isNotFound } from '../../../lib/api/apiError';
import { RecordNotFound } from '../../../components/data/RecordNotFound';
import { displayDate } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { DataState } from '../../../components/data/DataState';
import { useClients, useSaleQuery } from '../api/useSales';
import { useDeleteSale, useSetGreenfield, useValidateSale } from '../api/useSaleMutations';
import { GreenfieldBadge } from './GreenfieldBadge';
import { DuplicateBadge } from './DuplicateBadge';
import { isHeldDuplicate, useCanEditSale } from '../saleGates';
import { useApproveDuplicate } from '../api/useSaleEdits';
import { HistoryTab } from '../../audit/components/HistoryTab';
import styles from './SaleDetailView.module.css';
import { splitCityRegion } from '../../../lib/geo/regions';
import { sameLabel } from '../../../lib/format/text';

export function SaleDetailView({ id }: { id: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();

  const canViewClients = useCan('clients:view');
  const canApprove = useCan('sales:approve');
  const canDelete = useCan('sales:delete');

  const query = useSaleQuery(id);
  const clients = useClients(canViewClients);
  const validate = useValidateSale();
  const greenfield = useSetGreenfield();
  const remove = useDeleteSale();
  const approveDup = useApproveDuplicate();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sale = query.data;
  const { canEdit, asRequest } = useCanEditSale(sale);
  const held = !!sale && isHeldDuplicate(sale);

  const onApproveDuplicate = () =>
    sale &&
    approveDup.mutate(sale.id, {
      onSuccess: () => toast({ title: 'Duplicate approved', description: `${sale.sale_code} can now be validated.`, tone: 'success' }),
      onError,
    });
  const clientName = sale && clients.data?.find((c) => c.id === sale.client_id)?.name;

  const onValidate = () =>
    sale &&
    validate.mutate(
      { id: sale.id },
      {
        onSuccess: () => toast({ title: 'Sale validated', tone: 'success' }),
        onError,
      },
    );

  const onToggleGreenfield = () =>
    sale &&
    greenfield.mutate(
      { id: sale.id, body: { is_greenfield: !sale.is_greenfield } },
      {
        onSuccess: () =>
          toast({
            title: sale.is_greenfield ? 'Greenfield cleared' : 'Marked greenfield',
            tone: 'success',
          }),
        onError,
      },
    );

  const onDelete = () =>
    sale &&
    remove.mutate(sale.id, {
      onSuccess: () => {
        toast({ title: 'Sale deleted', tone: 'success' });
        navigate('/sales');
      },
      onError,
    });

  if (isNotFound(query.error)) {
    return <RecordNotFound what="sale" backTo="/sales" backLabel="Back to sales" />;
  }

  return (
    <DataState
      isLoading={query.isLoading}
      isError={query.isError}
      isEmpty={false}
      onRetry={() => query.refetch()}
      errorMessage="This sale could not be loaded. It may not exist, or you may not have access."
    >
      {sale && (
        <div className={styles.wrap}>
          <div className={styles.titleRow}>
            <h1 className={styles.saleId}>
              <span className="mono">{sale.sale_code}</span>
            </h1>
            <StatusPill status={sale.status} />
            <DuplicateBadge sale={sale} />
          </div>

          {held && (
            <Banner tone="warning" title="Possible duplicate">
              Another live sale for this client has the same MPU ID
              {sale.duplicate_of_sale_code ? (
                <>
                  {' '}(<span className="mono">{sale.duplicate_of_sale_code}</span>)
                </>
              ) : null}
              . This sale cannot be validated until a manager or admin approves it.
            </Banner>
          )}

          {sale.has_pending_edit_request && (
            <Banner tone="info" title="Edit requested">
              The rep asked to change this sale. The request is waiting for a manager or admin.
            </Banner>
          )}

          {sale.editable && sale.edit_window_ends_on && (
            <p className={styles.muted}>Editable until {displayDate(sale.edit_window_ends_on)}.</p>
          )}

          {sale.status === 'paid' && (
            <Banner tone="info" title="This sale is paid">
              Its commission snapshots are locked and cannot be changed. Corrections happen through a new
              adjustment.
            </Banner>
          )}

          <div className={styles.grid}>
            <Card title="Customer">
              <dl className={styles.dl}>
                <dt>Name</dt>
                <dd>{sale.customer_name}</dd>
                <dt>Address</dt>
                <dd>
                  {sale.street}
                  <br />
                  {/* An old "Edmonton, AB" city must not print the province twice. 2026-11-18 */}
                  {splitCityRegion(sale.city, sale.province_state).city ?? sale.city}, {sale.province_state} {sale.postal_code}
                </dd>
              </dl>
            </Card>

            <Card title="Sale">
              <dl className={styles.dl}>
                <dt>Client</dt>
                <dd>{canViewClients ? clientName ?? '—' : '—'}</dd>
                <dt>Sale date</dt>
                <dd className="mono">{displayDate(sale.sale_date)}</dd>
                <dt>MPU ID</dt>
                <dd className="mono">{sale.mpu_id ?? '—'}</dd>
                <dt>Activation date</dt>
                <dd className="mono">{displayDate(sale.activation_date)}</dd>
                <dt>Greenfield</dt>
                <dd>
                  <GreenfieldBadge on={sale.is_greenfield} />
                </dd>
                <dt>Pay period</dt>
                <dd>
                  {sale.pay_period
                    ? `#${sale.pay_period.period_number} (${displayDate(sale.pay_period.start_date)} – ${displayDate(sale.pay_period.end_date)})`
                    : 'Not assigned'}
                </dd>
              </dl>
            </Card>
          </div>

          <Card title="Products">
            {sale.sale_items.length === 0 ? (
              <p className={styles.muted}>No line items.</p>
            ) : (
              <ul className={styles.items}>
                {sale.sale_items.map((item) => (
                  <li key={item.id} className={styles.item}>
                    {/* The product NAME carries the speed ("Fibre 1gig/2.5gig"); the type key alone can't. */}
                    <span>
                      {item.product?.name ?? productTypeLabel(item.product_type)}
                      {/* Skip the type when the name already says it ("TV · TV"). 2026-11-18 */}
                      {!sameLabel(item.product?.name, productTypeLabel(item.product_type)) && (
                        <span className={styles.muted}> · {productTypeLabel(item.product_type)}</span>
                      )}
                    </span>
                    <span className={styles.muted}>
                      {item.product_type === 'internet' ? (item.counts_toward_tally ? 'Internet' : 'Greenfield') : 'Add-on'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="History">
            <HistoryTab entityType="sales" entityId={sale.id} />
          </Card>

          <div className={styles.actions}>
            {/* Validate: only while Entered, and only with sales:approve (server re-checks). — SALE-004 */}
            {sale.status === 'entered' && canApprove && (
              held ? (
                // A held duplicate cannot be validated; the tooltip says why. The span keeps the tooltip
                // working on a disabled button. — 2026-11-16
                <Tooltip content="Approve the duplicate first">
                  <span>
                    <Button leftIcon={<Check size={16} />} variant="primary" disabled>
                      Validate
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Button leftIcon={<Check size={16} />} variant="primary" onClick={onValidate} loading={validate.isPending}>
                  Validate
                </Button>
              )
            )}
            {held && canApprove && sale.status !== 'deleted' && (
              <Button leftIcon={<Check size={16} />} variant="primary" onClick={onApproveDuplicate} loading={approveDup.isPending}>
                Approve duplicate
              </Button>
            )}
            {canEdit && !sale.has_pending_edit_request && (
              <Button leftIcon={<Pencil size={16} />} variant="secondary" onClick={() => navigate(`/sales/${sale.id}/edit`)}>
                {asRequest ? 'Request edit' : 'Edit'}
              </Button>
            )}
            {/* Greenfield two-step: admin confirms/clears the request before validating. — SALE-006 */}
            {sale.status === 'entered' && canApprove && (
              <Button leftIcon={<Sprout size={16} />} variant="secondary" onClick={onToggleGreenfield} loading={greenfield.isPending}>
                {sale.is_greenfield ? 'Clear greenfield' : 'Mark greenfield'}
              </Button>
            )}
            {/* Delete: soft-delete, only while Entered or Validated, with sales:delete. — SALE-005 */}
            {(sale.status === 'entered' || sale.status === 'validated') && canDelete && (
              <Button leftIcon={<Trash2 size={16} />} variant="destructive" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            {/* No "back to sales" here — navigation lives in the page header, so this row is only ever
                actions that change THIS sale. Two routes to the same list read as two different things. */}
          </div>

          <Modal
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Delete this sale?"
            footer={
              <>
                <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button leftIcon={<Trash2 size={16} />} variant="destructive" onClick={onDelete} loading={remove.isPending}>
                  Delete sale
                </Button>
              </>
            }
          >
            Sale <span className="mono">{sale.sale_code}</span> will be soft-deleted (kept in the ledger,
            hidden from the active queue). This cannot be undone from here.
          </Modal>
        </div>
      )}
    </DataState>
  );
}
