/**
 * Sale action gates shared by the list rows, the detail view and the edit page (2026-11-16). CONVENIENCE
 * only: the server re-checks the 5-day window, the status, the duplicate hold and the permission.
 */
import { useAuth } from '../../auth/useAuth';
import { useCan } from '../../auth/useCan';
import type { Sale } from './sales.types';

type Flagged = Pick<Sale, 'duplicate_of_sale_id' | 'duplicate_approved_at'>;

/** True while the sale is a possible duplicate nobody has approved yet (validate must wait). */
export const isHeldDuplicate = (sale: Flagged): boolean => !!sale.duplicate_of_sale_id && !sale.duplicate_approved_at;

/** Edit is offered inside the window to an editor (sales:edit), or to the rep who sold it (as a request). */
export function useCanEditSale(sale: Pick<Sale, 'editable' | 'rep_id'> | undefined) {
  const { repId } = useAuth();
  const canEditPerm = useCan('sales:edit');
  const own = !!repId && sale?.rep_id === repId;
  return { canEdit: !!sale?.editable && (canEditPerm || own), asRequest: !canEditPerm };
}
