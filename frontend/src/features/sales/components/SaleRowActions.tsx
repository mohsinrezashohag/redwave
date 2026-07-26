/**
 * SaleRowActions — the per-row action menu, gated by useCan + the sale's status (CONVENIENCE only —
 * the server still authorizes every call, CLAUDE §5). View (always), Validate (entered + sales:approve),
 * Delete (entered|validated + sales:delete, with a destructive confirm restating the consequence).
 */
import { CheckCircle2, Eye, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal, ModalClose, useToast } from '../../../components/ui';
import { RowActions } from '../../../components/data/RowActions';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useDeleteSale, useValidateSale } from '../api/useSaleMutations';
import type { Sale } from '../sales.types';

export function SaleRowActions({ sale }: { sale: Sale }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const validate = useValidateSale();
  const remove = useDeleteSale();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Call hooks unconditionally, then combine with status (rules-of-hooks). Gating is convenience only.
  const canApprove = useCan('sales:approve');
  const canDeletePerm = useCan('sales:delete');
  const canValidate = sale.status === 'entered' && canApprove;
  const canDelete = (sale.status === 'entered' || sale.status === 'validated') && canDeletePerm;

  const doValidate = () =>
    validate.mutate(
      { id: sale.id },
      {
        onSuccess: () => toast({ title: 'Sale validated', description: sale.sale_code, tone: 'success' }),
        onError,
      },
    );

  const doDelete = () =>
    remove.mutate(sale.id, {
      onSuccess: () => {
        toast({ title: 'Sale deleted', description: sale.sale_code, tone: 'success' });
        setConfirmDelete(false);
      },
      onError,
    });

  return (
    <>
      <RowActions
        label="Row actions"
        items={[
          { label: 'View', icon: <Eye size={15} />, onSelect: () => navigate(`/sales/${sale.id}`) },
          ...(canValidate ? [{ label: 'Validate', icon: <CheckCircle2 size={15} />, onSelect: doValidate }] : []),
          ...(canDelete
            ? ['separator' as const, { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => setConfirmDelete(true) }]
            : []),
        ]}
      />

      <Modal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this sale?"
        description={`Sale ${sale.sale_code} will be removed from active lists. This is a soft delete (the record is preserved) and cannot be done once the sale is paid.`}
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button variant="destructive" loading={remove.isPending} onClick={doDelete}>
              Delete sale
            </Button>
          </>
        }
      />
    </>
  );
}
