/**
 * SaleDetailView — the deep-linkable detail pattern (route `/sales/:id`, not a drawer). Shows the
 * composite Sale ID, lifecycle status, customer + address, derived pay period (null → "Not assigned"),
 * and the line items (product type + counts_toward_tally). The permitted actions are gated by `useCan`
 * AND the §16 lifecycle status — convenience only; the server is the real gate (CLAUDE §5). — SALE-004
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banner,
  Button,
  Card,
  Modal,
  StatusPill,
  useToast,
} from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { DataState } from '../../../components/data/DataState';
import { useClients, useSaleQuery } from '../api/useSales';
import { useDeleteSale, useSetGreenfield, useValidateSale } from '../api/useSaleMutations';
import { GreenfieldBadge } from './GreenfieldBadge';
import { HistoryTab } from '../../audit/components/HistoryTab';
import styles from './SaleDetailView.module.css';

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
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sale = query.data;
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

  return (
    <DataState
      isLoading={query.isLoading}
      isError={query.isError}
      isEmpty={false}
      onRetry={() => query.refetch()}
      errorMessage="This sale could not be loaded — it may not exist or you may not have access."
    >
      {sale && (
        <div className={styles.wrap}>
          <div className={styles.titleRow}>
            <h1 className={styles.saleId}>
              <span className="mono">{sale.sale_code}</span>
            </h1>
            <StatusPill status={sale.status} />
          </div>

          {sale.status === 'paid' && (
            <Banner tone="info" title="This sale is paid">
              Its commission snapshots are locked and cannot be changed. Corrections happen via a new
              clawback or adjustment.
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
                  {sale.city}, {sale.province_state} {sale.postal_code}
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
                      <span className={styles.muted}> · {productTypeLabel(item.product_type)}</span>
                    </span>
                    <span className={styles.muted}>
                      {item.counts_toward_tally ? 'Counts toward tally' : 'Excluded from tally'}
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
              <Button variant="primary" onClick={onValidate} loading={validate.isPending}>
                Validate
              </Button>
            )}
            {/* Greenfield two-step: admin confirms/clears the request before validating. — SALE-006 */}
            {sale.status === 'entered' && canApprove && (
              <Button variant="secondary" onClick={onToggleGreenfield} loading={greenfield.isPending}>
                {sale.is_greenfield ? 'Clear greenfield' : 'Mark greenfield'}
              </Button>
            )}
            {/* Delete: soft-delete, only while Entered or Validated, with sales:delete. — SALE-005 */}
            {(sale.status === 'entered' || sale.status === 'validated') && canDelete && (
              <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <Button variant="tertiary" onClick={() => navigate('/sales')}>
              Back to sales
            </Button>
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
                <Button variant="destructive" onClick={onDelete} loading={remove.isPending}>
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
