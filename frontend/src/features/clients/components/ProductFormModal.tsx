/**
 * ProductFormModal — create or edit a per-client product (RHF+zod). `product_type` is **immutable after
 * creation** (sale_items & rates reference it) — it's set on create and shown READ-ONLY on edit (the update
 * body omits it). Soft-deactivate is a separate row action. Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge, Button, FormField, Input, Modal, MoneyInput, Select, Switch, useToast } from '../../../components/ui';
import { PayPeriodSelect } from '../../../components/data/PayPeriodSelect';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCan } from '../../../auth/useCan';
import { todayIso } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { useProductTypes } from '../../productTypes/api/useProductTypes';
import { useCreateProduct, useUpdateProduct } from '../api/useClientMutations';
import type { Product } from '../clients.types';
import styles from './clients.module.css';

export type ProductFormState = { mode: 'create'; clientId: string } | { mode: 'edit'; product: Product } | null;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
const createSchema = z
  .object({
    name: z.string().min(1, 'Required').max(150),
    product_type: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Choose a product type'),
    set_rate: z.boolean(),
    amount: z.string().optional(),
    effective_from: z.string().optional(),
  })
  .refine((v) => !v.set_rate || (v.amount && MONEY.test(v.amount)), { message: 'Enter an amount (max 2 dp)', path: ['amount'] })
  .refine((v) => !v.set_rate || (v.effective_from && DATE.test(v.effective_from) && v.effective_from >= todayIso()), {
    message: 'Choose a current/future period',
    path: ['effective_from'],
  });
const editSchema = z.object({ name: z.string().min(1, 'Required').max(150) });
type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;

export function ProductFormModal({ state, onClose }: { state: ProductFormState; onClose: () => void }) {
  const open = state !== null;
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={state?.mode === 'edit' ? 'Edit product' : 'Add product'}>
      {state?.mode === 'create' && <CreateProductForm clientId={state.clientId} onClose={onClose} />}
      {state?.mode === 'edit' && <EditProductForm product={state.product} onClose={onClose} />}
    </Modal>
  );
}

function CreateProductForm({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateProduct();
  const canSetRate = useCan('billing_rates:create');
  const types = useProductTypes('active');
  const typeOptions = (types.data ?? []).map((t) => ({ value: t.key, label: t.label }));
  const { control, register, handleSubmit, watch, formState } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', product_type: '', set_rate: false, amount: '', effective_from: '' },
  });
  const setRate = watch('set_rate');

  const onSubmit = (values: CreateValues) =>
    create.mutate(
      {
        clientId,
        body: {
          name: values.name,
          product_type: values.product_type,
          initial_billing_rate: values.set_rate ? { amount: values.amount!, effective_from: values.effective_from! } : undefined,
        },
      },
      { onSuccess: () => { toast({ title: 'Product added', tone: 'success' }); onClose(); }, onError },
    );

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField label="Name" required error={formState.errors.name?.message}>
        <Input {...register('name')} placeholder="Fibre 1gig" />
      </FormField>
      <Controller
        control={control}
        name="product_type"
        render={({ field }) => (
          <FormField label="Product type" required error={formState.errors.product_type?.message} help="Cannot be changed after creation.">
            <Select
              options={typeOptions}
              value={field.value}
              onValueChange={field.onChange}
              placeholder={types.isLoading ? 'Loading types…' : 'Select a type'}
            />
          </FormField>
        )}
      />

      {canSetRate && (
        <Controller
          control={control}
          name="set_rate"
          render={({ field }) => (
            <label className={styles.switchRow}>
              <span>Set an initial client-billing rate (what we charge the client)</span>
              <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Set initial billing rate" />
            </label>
          )}
        />
      )}
      {canSetRate && setRate && (
        <div className={styles.rateRow}>
          <FormField label="Billing amount" required error={formState.errors.amount?.message}>
            <MoneyInput {...register('amount')} placeholder="0.00" />
          </FormField>
          <Controller
            control={control}
            name="effective_from"
            render={({ field }) => (
              <FormField label="Effective from" required error={formState.errors.effective_from?.message}>
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
          Add product
        </Button>
      </div>
    </form>
  );
}

function EditProductForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const update = useUpdateProduct();
  const { register, handleSubmit, formState } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: product.name },
  });

  const onSubmit = (values: EditValues) =>
    update.mutate(
      { id: product.id, body: { name: values.name } },
      { onSuccess: () => { toast({ title: 'Product updated', tone: 'success' }); onClose(); }, onError },
    );

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField label="Name" required error={formState.errors.name?.message}>
        <Input {...register('name')} />
      </FormField>
      <FormField label="Product type" help="Set when the product is created and can’t be changed.">
        <span className={styles.readonlyType}>
          <Badge tone="neutral">{productTypeLabel(product.product_type)}</Badge>
        </span>
      </FormField>
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
