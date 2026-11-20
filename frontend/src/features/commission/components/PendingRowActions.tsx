/**
 * PendingRowActions — the edit/delete actions for an effective-dated row, shown ONLY when the row is
 * pending (current/past rows are immutable — the server 422s anyway). Shared by the commission config
 * sections. Tokens only.
 */
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui';
import type { RateStatus } from '../../../components/ui';
import styles from './commission.module.css';

export function PendingRowActions({
  status,
  onEdit,
  onDelete,
}: {
  status: RateStatus;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  if (status !== 'pending') return null;
  return (
    <span className={styles.rowActions}>
      {onEdit && (
        <Button leftIcon={<Pencil size={16} />} variant="tertiary" size="sm" onClick={onEdit}>
          Edit
        </Button>
      )}
      {onDelete && (
        <Button leftIcon={<Trash2 size={16} />} variant="tertiary" size="sm" onClick={onDelete}>
          Delete
        </Button>
      )}
    </span>
  );
}
