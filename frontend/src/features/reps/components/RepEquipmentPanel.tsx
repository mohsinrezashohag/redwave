/**
 * RepEquipmentPanel — equipment issued to a rep (iPad, phone, …) with its deposit, tracked through
 * assigned → returned / withheld (SRS HRM-006). The API existed with no screen until now. hrm:view to see;
 * hrm:edit to assign / return / withhold (server-enforced). Deposit is a money STRING (#1) — displayed, never
 * computed. Withholding a deposit is a decision about a person's money, so it confirms first. Tokens only.
 */
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { Badge, Button, ConfirmDialog, DatePicker, FormField, Input, Modal, MoneyInput, Select, Table, TBody, TD, TH, THead, TR, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { RowActions } from '../../../components/data/RowActions';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCan } from '../../../auth/useCan';
import { money } from '../../../lib/format/money';
import { displayDate, todayIso } from '../../../lib/format/date';
import { useAssignEquipment, useRepEquipment, useUpdateEquipment } from '../api/useRepProfile';
import type { EquipmentStatus, RepEquipment } from '../reps.types';
import styles from './reps.module.css';

const TYPES = ['iPad', 'Phone', 'Laptop', 'Tablet'] as const;
const OTHER = '__other__';
const TYPE_OPTIONS = [...TYPES.map((t) => ({ value: t, label: t })), { value: OTHER, label: 'Other…' }];

const STATUS_TONE: Record<EquipmentStatus, 'info' | 'success' | 'danger'> = {
  assigned: 'info',
  returned: 'success',
  withheld: 'danger',
};
const STATUS_LABEL: Record<EquipmentStatus, string> = { assigned: 'Assigned', returned: 'Returned', withheld: 'Deposit withheld' };

export function RepEquipmentPanel({ repId }: { repId: string }) {
  const canEdit = useCan('hrm:edit');
  const list = useRepEquipment(repId);
  const update = useUpdateEquipment(repId);
  const onError = useApiErrorToast();
  const { toast } = useToast();
  const [assignOpen, setAssignOpen] = useState(false);
  const [withhold, setWithhold] = useState<RepEquipment | null>(null);
  const rows = list.data ?? [];

  const setStatus = (item: RepEquipment, status: 'returned' | 'withheld', done?: () => void) =>
    update.mutate(
      { id: item.id, body: status === 'returned' ? { status, returned_date: todayIso() } : { status } },
      {
        onSuccess: () => {
          toast({ title: status === 'returned' ? 'Marked returned' : 'Deposit withheld', description: item.identifier, tone: 'success' });
          done?.();
        },
        onError,
      },
    );

  return (
    <>
      {canEdit && (
        <div className={styles.panelHead}>
          <Button variant="secondary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setAssignOpen(true)}>
            Assign equipment
          </Button>
        </div>
      )}
      <DataState
        isLoading={list.isLoading}
        isError={list.isError}
        isEmpty={rows.length === 0}
        onRetry={() => list.refetch()}
        emptyNode={<p className={styles.muted}>No equipment issued to this rep.</p>}
      >
        <Table>
          <THead>
            <TR>
              <TH>Type</TH>
              <TH>Serial / asset tag</TH>
              <TH align="right">Deposit</TH>
              <TH>Assigned</TH>
              <TH>Returned</TH>
              <TH>Status</TH>
              {canEdit && <TH align="right">Actions</TH>}
            </TR>
          </THead>
          <TBody>
            {rows.map((e) => (
              <TR key={e.id}>
                <TD>{e.equipment_type}</TD>
                <TD className="mono">{e.identifier}</TD>
                <TD numeric>{money(e.deposit_amount)}</TD>
                <TD className="mono">{displayDate(e.assigned_date)}</TD>
                <TD className="mono">{e.returned_date ? displayDate(e.returned_date) : '—'}</TD>
                <TD>
                  <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                </TD>
                {canEdit && (
                  <TD align="right">
                    {e.status === 'assigned' ? (
                      <RowActions
                        label={`Actions for ${e.identifier}`}
                        items={[
                          { label: 'Mark returned', onSelect: () => setStatus(e, 'returned') },
                          { label: 'Withhold deposit', danger: true, onSelect: () => setWithhold(e) },
                        ]}
                      />
                    ) : (
                      '—'
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </DataState>

      <AssignEquipmentModal repId={repId} open={assignOpen} onClose={() => setAssignOpen(false)} />
      <ConfirmDialog
        open={withhold !== null}
        onOpenChange={(o) => !o && setWithhold(null)}
        title="Withhold this deposit?"
        description={
          withhold
            ? `The ${money(withhold.deposit_amount)} deposit on ${withhold.equipment_type} ${withhold.identifier} will be recorded as withheld (not returned to the rep).`
            : undefined
        }
        confirmLabel="Withhold deposit"
        destructive
        loading={update.isPending}
        onConfirm={() => withhold && setStatus(withhold, 'withheld', () => setWithhold(null))}
      />
    </>
  );
}

const assignSchema = z
  .object({
    type: z.string().min(1, 'Pick a type'),
    other_type: z.string().max(50),
    identifier: z.string().trim().min(1, 'Required').max(100),
    deposit_amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount, e.g. 150.00'),
    assigned_date: z.string().min(1, 'Required'),
  })
  .refine((v) => v.type !== OTHER || v.other_type.trim().length > 0, { path: ['other_type'], message: 'Name the equipment' });
type AssignValues = z.infer<typeof assignSchema>;

function AssignEquipmentModal({ repId, open, onClose }: { repId: string; open: boolean; onClose: () => void }) {
  const assign = useAssignEquipment(repId);
  const onError = useApiErrorToast();
  const { toast } = useToast();
  const { control, register, handleSubmit, formState, reset } = useForm<AssignValues>({
    resolver: zodResolver(assignSchema),
    defaultValues: { type: 'iPad', other_type: '', identifier: '', deposit_amount: '', assigned_date: todayIso() },
  });
  const errors = formState.errors;
  const type = useWatch({ control, name: 'type' });

  const close = () => {
    reset();
    onClose();
  };
  const onSubmit = (v: AssignValues) =>
    assign.mutate(
      {
        equipment_type: v.type === OTHER ? v.other_type.trim() : v.type,
        identifier: v.identifier.trim(),
        deposit_amount: v.deposit_amount,
        assigned_date: v.assigned_date,
      },
      {
        onSuccess: (e) => {
          toast({ title: 'Equipment assigned', description: `${e.equipment_type} ${e.identifier}`, tone: 'success' });
          close();
        },
        onError,
      },
    );

  return (
    <Modal open={open} onOpenChange={(o) => !o && close()} title="Assign equipment">
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <FormField label="Type" required error={errors.type?.message}>
              <Select options={TYPE_OPTIONS} value={field.value} onValueChange={field.onChange} aria-label="Equipment type" />
            </FormField>
          )}
        />
        {type === OTHER && (
          <FormField label="Equipment" required error={errors.other_type?.message}>
            <Input {...register('other_type')} placeholder="Card reader" />
          </FormField>
        )}
        <FormField label="Serial number / asset tag" required error={errors.identifier?.message}>
          <Input {...register('identifier')} placeholder="DMPXK2Q1LMPF" className="mono" />
        </FormField>
        <FormField label="Deposit" required error={errors.deposit_amount?.message} help="The amount the rep put down for it.">
          <MoneyInput {...register('deposit_amount')} placeholder="150.00" />
        </FormField>
        <Controller
          control={control}
          name="assigned_date"
          render={({ field }) => (
            <FormField label="Assigned on" required error={errors.assigned_date?.message}>
              <DatePicker value={field.value} onChange={field.onChange} invalid={!!errors.assigned_date} aria-label="Assigned on" />
            </FormField>
          )}
        />
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={assign.isPending}>
            Assign
          </Button>
        </div>
      </form>
    </Modal>
  );
}
