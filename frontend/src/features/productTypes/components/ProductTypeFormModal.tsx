/**
 * ProductTypeFormModal — add or edit a product type (RHF+zod). A NEW type is always a standard add-on
 * (behaviour is forced server-side — never selectable here), so it can never change tally/greenfield logic
 * (#5/#9). Create may carry an INLINE commission flat rate (what we pay the rep) written to the commission
 * stream. Edit changes the label + active flag only; the key + behaviour are immutable and a system (core)
 * type cannot be deactivated. Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge, Banner, Button, FormField, Input, Modal, MoneyInput, Switch, useToast } from '../../../components/ui';
import { PayPeriodSelect } from '../../../components/data/PayPeriodSelect';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useCreateProductType, useUpdateProductType } from '../api/useProductTypes';
import { behaviourLabel, behaviourTone } from '../productTypeBehaviour';
import type { ProductType } from '../productTypes.types';
import styles from './productTypes.module.css';

export type ProductTypeFormState = { mode: 'create' } | { mode: 'edit'; type: ProductType } | null;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;

const createSchema = z
  .object({
    key: z
      .string()
      .min(1, 'Required')
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, 'Lowercase snake_case (start with a letter)'),
    label: z.string().min(1, 'Required').max(60),
    set_rate: z.boolean(),
    amount: z.string().optional(),
    effective_from: z.string().optional(),
  })
  .refine((v) => !v.set_rate || (v.amount && MONEY.test(v.amount)), { message: 'Enter an amount (max 2 dp)', path: ['amount'] })
  .refine((v) => !v.set_rate || (v.effective_from && DATE.test(v.effective_from) && v.effective_from >= todayIso()), {
    message: 'Choose a current/future period',
    path: ['effective_from'],
  });
type CreateValues = z.infer<typeof createSchema>;

const editSchema = z.object({ label: z.string().min(1, 'Required').max(60), is_active: z.boolean() });
type EditValues = z.infer<typeof editSchema>;

export function ProductTypeFormModal({ state, onClose }: { state: ProductTypeFormState; onClose: () => void }) {
  const open = state !== null;
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={state?.mode === 'edit' ? 'Edit product type' : 'Add product type'}>
      {state?.mode === 'create' && <CreateForm onClose={onClose} />}
      {state?.mode === 'edit' && <EditForm type={state.type} onClose={onClose} />}
    </Modal>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateProductType();
  const { control, register, handleSubmit, watch, formState } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { key: '', label: '', set_rate: false, amount: '', effective_from: '' },
  });
  const errors = formState.errors;
  const setRate = watch('set_rate');

  const onSubmit = (v: CreateValues) =>
    create.mutate(
      {
        key: v.key,
        label: v.label,
        initial_flat_rate: v.set_rate ? { amount: v.amount!, effective_from: v.effective_from! } : undefined,
      },
      { onSuccess: () => { toast({ title: 'Product type added', tone: 'success' }); onClose(); }, onError },
    );

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <Banner tone="info" title="Standard add-on">
        A new type is billable and flat-rated, but does NOT count toward the internet tier tally and is not
        greenfield — that behaviour is reserved for the core types and can’t be changed.
      </Banner>
      <FormField label="Key" required error={errors.key?.message} help="Immutable identifier, e.g. satellite.">
        <Input {...register('key')} placeholder="satellite" />
      </FormField>
      <FormField label="Label" required error={errors.label?.message}>
        <Input {...register('label')} placeholder="Satellite Internet" />
      </FormField>

      <Controller
        control={control}
        name="set_rate"
        render={({ field }) => (
          <label className={styles.switchRow}>
            <span>Set an initial commission flat rate (what we pay the rep)</span>
            <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Set initial commission flat rate" />
          </label>
        )}
      />
      {setRate && (
        <div className={styles.rateRow}>
          <FormField label="Flat rate amount" required error={errors.amount?.message}>
            <MoneyInput {...register('amount')} placeholder="0.00" />
          </FormField>
          <Controller
            control={control}
            name="effective_from"
            render={({ field }) => (
              <FormField label="Effective from" required error={errors.effective_from?.message}>
                <PayPeriodSelect value={field.value ?? ''} onChange={field.onChange} aria-label="Effective from period" />
              </FormField>
            )}
          />
        </div>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={create.isPending}>
          Add type
        </Button>
      </div>
    </form>
  );
}

function EditForm({ type, onClose }: { type: ProductType; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const update = useUpdateProductType();
  const { register, handleSubmit, control, formState } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { label: type.label, is_active: type.is_active },
  });

  const onSubmit = (v: EditValues) =>
    update.mutate(
      { key: type.key, body: { label: v.label, is_active: v.is_active } },
      { onSuccess: () => { toast({ title: 'Product type updated', tone: 'success' }); onClose(); }, onError },
    );

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField label="Key" help="Immutable — set at creation.">
        <span className={styles.readonlyRow}>
          <Badge tone="neutral">{type.key}</Badge>
          <Badge tone={behaviourTone(type.behaviour)}>{behaviourLabel(type.behaviour)}</Badge>
          {type.is_system && <Badge tone="info">Core</Badge>}
        </span>
      </FormField>
      <FormField label="Label" required error={formState.errors.label?.message}>
        <Input {...register('label')} />
      </FormField>
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <label className={styles.switchRow}>
            <span>Active{type.is_system ? ' (core types can’t be deactivated)' : ''}</span>
            <Switch checked={field.value} disabled={type.is_system} onCheckedChange={field.onChange} aria-label="Active" />
          </label>
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
