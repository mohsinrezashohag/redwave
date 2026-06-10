/**
 * IncentiveModal — create or edit an incentive/spiff (SRS COMM-005). BOTH modes are creatable, applied by
 * the engine (threshold-relative): **per_activation** (bonus beyond the threshold; blank = every activation)
 * and **one_time** (a single bonus once the rep reaches the threshold). Scope client = "All" or "Specific" →
 * a client picker via GET /v1/clients (a REFERENCE the backend validates, not a rate-stream join — #3 holds).
 * Money exact-decimal. Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button, DatePicker, FormField, Input, Modal, MoneyInput, RadioGroup, Select, useToast } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useProductTypes } from '../../productTypes/api/useProductTypes';
import { useClients } from '../api/useCommission';
import { useCreateIncentive, useUpdateIncentive } from '../api/useCommissionMutations';
import type { CreateIncentiveBody, Incentive } from '../commission.types';
import styles from './commission.module.css';

export type IncentiveFormState = { mode: 'create' } | { mode: 'edit'; incentive: Incentive } | null;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
const ALL = '__all__';

export function IncentiveModal({ state, onClose }: { state: IncentiveFormState; onClose: () => void }) {
  const open = state !== null;
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={state?.mode === 'edit' ? 'Edit incentive' : 'New incentive'}>
      {state?.mode === 'create' && <CreateForm onClose={onClose} />}
      {state?.mode === 'edit' && <EditForm incentive={state.incentive} onClose={onClose} />}
    </Modal>
  );
}

const createSchema = z
  .object({
    name: z.string().min(1, 'Required').max(150),
    target_type: z.enum(['per_activation', 'one_time']),
    target_count: z.string().optional(),
    scope_mode: z.enum(['all', 'specific']),
    scope_client_id: z.string().optional(),
    scope_product_type: z.string(),
    window_start: z.string().regex(DATE, 'Date required'),
    window_end: z.string().regex(DATE, 'Date required'),
    amount: z.string().regex(MONEY, 'Enter an amount (max 2 dp)'),
  })
  .superRefine((v, ctx) => {
    if (v.scope_mode === 'specific' && !v.scope_client_id) ctx.addIssue({ code: 'custom', path: ['scope_client_id'], message: 'Pick a client' });
    if (v.window_end < v.window_start) ctx.addIssue({ code: 'custom', path: ['window_end'], message: 'End must be on or after start' });
    const count = v.target_count?.trim() ? Number(v.target_count) : null;
    if (v.target_type === 'one_time' && (!count || count < 1)) {
      ctx.addIssue({ code: 'custom', path: ['target_count'], message: 'A one-time bonus needs a threshold (≥ 1)' });
    }
    if (count !== null && (!Number.isInteger(count) || count < 1)) {
      ctx.addIssue({ code: 'custom', path: ['target_count'], message: 'Enter a whole number ≥ 1' });
    }
  });
type CreateValues = z.infer<typeof createSchema>;

function CreateForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const canViewClients = useCan('clients:view');
  const create = useCreateIncentive();
  const { control, register, handleSubmit, formState } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', target_type: 'per_activation', target_count: '', scope_mode: 'all', scope_client_id: '', scope_product_type: ALL, window_start: todayIso(), window_end: todayIso(), amount: '' },
  });
  const errors = formState.errors;
  const scopeMode = useWatch({ control, name: 'scope_mode' });
  const targetType = useWatch({ control, name: 'target_type' });
  const clients = useClients(canViewClients && scopeMode === 'specific');
  const types = useProductTypes('active');
  const typeOptions = [
    { value: ALL, label: 'All product types' },
    ...(types.data ?? []).map((t) => ({ value: t.key, label: t.label })),
  ];

  const onSubmit = (values: CreateValues) => {
    const count = values.target_count?.trim() ? Number(values.target_count) : undefined;
    const body: CreateIncentiveBody = {
      name: values.name,
      scope_client_id: values.scope_mode === 'specific' ? values.scope_client_id : undefined,
      scope_product_type: values.scope_product_type === ALL ? undefined : values.scope_product_type,
      target_type: values.target_type,
      target_count: count,
      window_start: values.window_start,
      window_end: values.window_end,
      amount: values.amount,
    };
    create.mutate(body, { onSuccess: () => { toast({ title: 'Incentive created', tone: 'success' }); onClose(); }, onError });
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField label="Name" required error={errors.name?.message}>
        <Input {...register('name')} placeholder="July VF internet spiff" />
      </FormField>

      <Controller
        control={control}
        name="target_type"
        render={({ field }) => (
          <FormField label="Incentive mode">
            <RadioGroup
              ariaLabel="Incentive mode"
              value={field.value}
              onValueChange={field.onChange}
              options={[
                { value: 'per_activation', label: 'Per activation' },
                { value: 'one_time', label: 'One-time bonus' },
              ]}
            />
          </FormField>
        )}
      />
      <FormField
        label={targetType === 'one_time' ? 'Threshold (required)' : 'Threshold (optional)'}
        error={errors.target_count?.message}
        help={
          targetType === 'one_time'
            ? 'A single bonus pays once the rep reaches this many matching activations in the window.'
            : 'The bonus pays on each matching activation BEYOND this count. Leave blank to pay on every activation.'
        }
      >
        <Input type="number" min={1} {...register('target_count')} placeholder={targetType === 'one_time' ? 'e.g. 5' : 'blank = all'} />
      </FormField>

      <Controller
        control={control}
        name="scope_mode"
        render={({ field }) => (
          <FormField label="Scope: clients">
            <RadioGroup
              ariaLabel="Client scope"
              value={field.value}
              onValueChange={field.onChange}
              options={[
                { value: 'all', label: 'All clients' },
                { value: 'specific', label: 'Specific client', disabled: !canViewClients },
              ]}
            />
          </FormField>
        )}
      />
      {scopeMode === 'specific' && (
        <Controller
          control={control}
          name="scope_client_id"
          render={({ field }) => (
            <FormField label="Client" required error={errors.scope_client_id?.message}>
              <Select
                placeholder="Select a client"
                options={(clients.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.client_code})` }))}
                value={field.value || undefined}
                onValueChange={field.onChange}
              />
            </FormField>
          )}
        />
      )}

      <Controller
        control={control}
        name="scope_product_type"
        render={({ field }) => (
          <FormField label="Scope: product type" help="Optional.">
            <Select
              options={typeOptions}
              value={field.value}
              onValueChange={field.onChange}
            />
          </FormField>
        )}
      />

      <div className={styles.dates}>
        <Controller
          control={control}
          name="window_start"
          render={({ field }) => (
            <FormField label="Window start" required error={errors.window_start?.message}>
              <DatePicker value={field.value ?? ''} onChange={field.onChange} invalid={!!errors.window_start} aria-label="Window start" />
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="window_end"
          render={({ field }) => (
            <FormField label="Window end" required error={errors.window_end?.message}>
              <DatePicker value={field.value ?? ''} onChange={field.onChange} invalid={!!errors.window_end} aria-label="Window end" />
            </FormField>
          )}
        />
      </div>
      <FormField label="Amount" required error={errors.amount?.message} help={targetType === 'one_time' ? 'The one-time bonus.' : 'The per-activation bonus.'}>
        <MoneyInput {...register('amount')} placeholder="0.00" />
      </FormField>

      <div className={styles.footer}>
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={create.isPending}>
          Create incentive
        </Button>
      </div>
    </form>
  );
}

const editSchema = z.object({
  name: z.string().min(1, 'Required').max(150),
  amount: z.string().regex(MONEY, 'Enter an amount (max 2 dp)'),
  status: z.enum(['active', 'ended']),
});
type EditValues = z.infer<typeof editSchema>;

function EditForm({ incentive, onClose }: { incentive: Incentive; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const update = useUpdateIncentive();
  const { control, register, handleSubmit, formState } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: incentive.name, amount: incentive.amount, status: incentive.status },
  });

  const onSubmit = (values: EditValues) =>
    update.mutate(
      { id: incentive.id, body: values },
      { onSuccess: () => { toast({ title: 'Incentive updated', tone: 'success' }); onClose(); }, onError },
    );

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField label="Name" required error={formState.errors.name?.message}>
        <Input {...register('name')} />
      </FormField>
      <FormField label="Amount" required error={formState.errors.amount?.message}>
        <MoneyInput {...register('amount')} />
      </FormField>
      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <FormField label="Status" help="End to retire the incentive.">
            <Select
              options={[
                { value: 'active', label: 'Active' },
                { value: 'ended', label: 'Ended' },
              ]}
              value={field.value}
              onValueChange={field.onChange}
            />
          </FormField>
        )}
      />
      <div className={styles.footer}>
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={update.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
