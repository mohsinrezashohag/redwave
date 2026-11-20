/**
 * AssignManagerModal — bulk-assign the selected reps to a field manager. Drives POST /v1/reps/bulk-assign-
 * manager (hrm:edit; the server validates the manager + is the real gate). The manager options are the
 * Manager-role users. On success the roster (+ the manager-scoped views that read field_manager_id) updates.
 */
import { UserCheck } from 'lucide-react';
import { useState } from 'react';
import { Button, FormField, Modal, Select, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useBulkAssignManager } from '../api/useReps';

export function AssignManagerModal({
  open,
  repIds,
  managerOptions,
  onClose,
  onDone,
}: {
  open: boolean;
  repIds: string[];
  managerOptions: { value: string; label: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const assign = useBulkAssignManager();
  const [managerId, setManagerId] = useState('');

  const onConfirm = () => {
    if (!managerId || repIds.length === 0) return;
    assign.mutate(
      { rep_ids: repIds, field_manager_id: managerId },
      {
        onSuccess: (r) => {
          toast({ title: `Assigned ${r.count} rep${r.count === 1 ? '' : 's'}`, tone: 'success' });
          setManagerId('');
          onDone();
        },
        onError,
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !assign.isPending && onClose()}
      title="Assign to a field manager"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={assign.isPending}>
            Cancel
          </Button>
          <Button leftIcon={<UserCheck size={16} />} variant="primary" onClick={onConfirm} loading={assign.isPending} disabled={!managerId}>
            Assign {repIds.length} rep{repIds.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Reassign the <strong>{repIds.length}</strong> selected rep{repIds.length === 1 ? '' : 's'} to a field manager. The manager’s roster
        views (dashboards, approval queues) read from this.
      </p>
      <FormField label="Field manager">
        {managerOptions.length > 0 ? (
          <Select placeholder="Select a manager" options={managerOptions} value={managerId || undefined} onValueChange={setManagerId} />
        ) : (
          <p className="mono">No managers available (need users:view to list them).</p>
        )}
      </FormField>
    </Modal>
  );
}
