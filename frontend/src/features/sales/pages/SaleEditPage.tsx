/**
 * SaleEditPage — `/sales/:id/edit` (client meeting 2026-11-16). Reuses SaleForm in edit mode. Inside the
 * 5-day window an editor (sales:edit) saves directly; the rep who sold it sends an edit request instead.
 * The window and status come from the server (`editable` / `edit_window_ends_on`): no date math here, and
 * the server re-checks on save.
 */
import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Banner, Button, PageHeader } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { RecordNotFound } from '../../../components/data/RecordNotFound';
import { isNotFound } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { useSaleQuery } from '../api/useSales';
import { useCanEditSale } from '../saleGates';
import { SaleForm } from '../components/SaleForm';

export default function SaleEditPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useSaleQuery(id);
  const sale = query.data;
  const { canEdit, asRequest } = useCanEditSale(sale);

  if (isNotFound(query.error)) {
    return <RecordNotFound what="sale" backTo="/sales" backLabel="Back to sales" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader
        title={asRequest ? 'Request an edit' : 'Edit sale'}
        subtitle={
          sale?.editable && sale.edit_window_ends_on
            ? `Sales can be changed for 5 days after entry. This one until ${displayDate(sale.edit_window_ends_on)}.`
            : undefined
        }
        actions={
          <Button leftIcon={<ArrowLeft size={16} />} variant="secondary" onClick={() => navigate(`/sales/${id}`)}>
            Back to sale
          </Button>
        }
      />
      <DataState
        isLoading={query.isLoading}
        isError={query.isError}
        isEmpty={false}
        onRetry={() => query.refetch()}
        errorMessage="This sale could not be loaded."
      >
        {sale &&
          (!sale.editable ? (
            <Banner tone="warning" title="This sale can no longer be edited">
              Sales can be changed for 5 days after they are entered, and only before they go into a pay run.
            </Banner>
          ) : !canEdit ? (
            <Banner tone="warning" title="You cannot edit this sale">
              Only the rep who made it, or a manager or admin, can change a sale.
            </Banner>
          ) : sale.has_pending_edit_request && asRequest ? (
            <Banner tone="info" title="An edit is already waiting">
              Your earlier edit request for this sale is waiting for a manager or admin.
            </Banner>
          ) : (
            <SaleForm sale={sale} />
          ))}
      </DataState>
    </div>
  );
}
