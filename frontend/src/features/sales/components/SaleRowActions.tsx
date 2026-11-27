/**
 * SaleRowActions — the per-row action menu, gated by useCan + the sale's status (CONVENIENCE only —
 * the server still authorizes every call, CLAUDE §5). View (always), Edit (inside the 5-day window: an
 * admin/manager with sales:edit edits, the selling rep requests an edit), Approve duplicate (a held possible
 * duplicate + sales:approve), Validate (an unflagged entered sale + sales:approve; a held duplicate is cleared by Approve, which validates it), Delete
 * (entered|validated + sales:delete, with a destructive confirm restating the consequence).
 */
import { CheckCircle2, CopyCheck, Eye, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal, ModalClose, useToast } from '../../../components/ui';
import { RowActions } from '../../../components/data/RowActions';
import type { MenuEntry } from '../../../components/ui/DropdownMenu';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useDeleteSale, useValidateSale } from '../api/useSaleMutations';
import { useApproveDuplicate } from '../api/useSaleEdits';
import type { Sale } from '../sales.types';
import { isHeldDuplicate, useCanEditSale } from '../saleGates';

export function SaleRowActions({ sale }: { sale: Sale }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const validate = useValidateSale();
  const remove = useDeleteSale();
  const approveDup = useApproveDuplicate();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Call hooks unconditionally, then combine with status (rules-of-hooks). Gating is convenience only.
  const canApprove = useCan('sales:approve');
  const canDeletePerm = useCan('sales:delete');
  const { canEdit, asRequest } = useCanEditSale(sale);
  const held = isHeldDuplicate(sale);
  // A held duplicate is cleared by Approve (which also validates it, 2026-11-28), so Validate is offered only
  // for an unflagged sale still entered (the backlog from before auto-validate).
  const canValidate = sale.status === 'entered' && canApprove && !held;
  const canApproveDup = held && canApprove && sale.status !== 'deleted';
  const canDelete = (sale.status === 'entered' || sale.status === 'validated') && canDeletePerm;

  const doValidate = () =>
    validate.mutate(
      { id: sale.id },
      {
        onSuccess: () => toast({ title: 'Sale validated', description: sale.sale_code, tone: 'success' }),
        onError,
      },
    );

  const doApproveDup = () =>
    approveDup.mutate(sale.id, {
      onSuccess: () =>
        toast({ title: 'Duplicate approved', description: `${sale.sale_code} now counts and can be paid.`, tone: 'success' }),
      onError,
    });

  const doDelete = () =>
    remove.mutate(sale.id, {
      onSuccess: () => {
        toast({ title: 'Sale deleted', description: sale.sale_code, tone: 'success' });
        setConfirmDelete(false);
      },
      onError,
    });

  const items: MenuEntry[] = [
    { label: 'View', icon: <Eye size={15} />, onSelect: () => navigate(`/sales/${sale.id}`) },
    ...(canEdit
      ? [{ label: asRequest ? 'Request edit' : 'Edit', icon: <Pencil size={15} />, onSelect: () => navigate(`/sales/${sale.id}/edit`) }]
      : []),
    ...(canApproveDup ? [{ label: 'Approve duplicate', icon: <CopyCheck size={15} />, onSelect: doApproveDup }] : []),
    ...(canValidate
      ? [
          { label: 'Validate', icon: <CheckCircle2 size={15} />, onSelect: doValidate },
        ]
      : []),
    ...(canDelete
      ? ['separator' as const, { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => setConfirmDelete(true) }]
      : []),
  ];

  return (
    <>
      <RowActions label="Row actions" iconOnly items={items} />

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
            <Button leftIcon={<Trash2 size={16} />} variant="destructive" loading={remove.isPending} onClick={doDelete}>
              Delete sale
            </Button>
          </>
        }
      />
    </>
  );
}
