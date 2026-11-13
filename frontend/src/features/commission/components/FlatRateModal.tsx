/**
 * FlatRateModal — add or edit a future-dated REP RATE (#10 supersession; back-date → 422). Any active product
 * type (internet, greenfield internet, TV, add-ons), optionally for ONE product of the chosen client. No tiers
 * since 2026-11-13: each item pays one rate. Money exact-decimal via MoneyInput. Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge, Banner, Button, FormField, Modal, MoneyInput, Select, useToast, ModalClose } from '../../../components/ui';
import { PayPeriodSelect } from '../../../components/data/PayPeriodSelect';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { useProductTypes } from '../../productTypes/api/useProductTypes';
import { useCreateFlatRate, useUpdateFlatRate } from '../api/useCommissionMutations';
import { ClientScopeField } from './ClientScopeField';
import { scopeLabel } from '../clientScope';
import { useClients, useProductNames } from '../api/useCommission';
import { useClientProducts } from '../../clients/api/useClients';
import { useCan } from '../../../auth/useCan';
import type { FlatRate } from '../commission.types';
import styles from './commission.module.css';

/** Select sentinel for "no single product" (Radix Select forbids an empty value). */
const ALL_PRODUCTS = '__all__';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');

const schema = z
  .object({
    scope_mode: z.enum(['all', 'specific']),
    client_id: z.string().optional(),
    product_type: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Choose a product type'),
    product_id: z.string().optional(),
    amount: z.string().regex(MONEY, 'Enter an amount (max 2 dp)'),
    effective_from: z.string().regex(DATE, 'Date required').refine((d) => d >= todayIso(), 'Must be today or later'),
    effective_to: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.scope_mode === 'specific' && !v.client_id) {
      ctx.addIssue({ code: 'custom', path: ['client_id'], message: 'Pick a client' });
    }
  });
type FormValues = z.infer<typeof schema>;

export function FlatRateModal({
  open,
  rate,
  defaultClientId,
  onClose,
}: {
  open: boolean;
  rate?: FlatRate;
  /** Pre-selects the scope from the page selector; undefined = the global row. */
  defaultClientId?: string;
  onClose: () => void;
}) {
  const isEdit = !!rate;
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateFlatRate();
  const update = useUpdateFlatRate();
  // Every active product type takes a rep rate (no tiers since 2026-11-13).
  const types = useProductTypes('active');
  const typeOptions = (types.data ?? []).map((t) => ({ value: t.key, label: t.label }));
  const { control, register, handleSubmit, formState, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: rate
      ? {
          scope_mode: rate.client_id ? 'specific' : 'all',
          client_id: rate.client_id ?? '',
          product_type: rate.product_type,
          product_id: rate.product_id ?? ALL_PRODUCTS,
          amount: rate.amount,
          effective_from: dateOnly(rate.effective_from),
          effective_to: dateOnly(rate.effective_to),
        }
      : {
          scope_mode: defaultClientId ? 'specific' : 'all',
          client_id: defaultClientId ?? '',
          product_type: '',
          product_id: ALL_PRODUCTS,
          amount: '',
          effective_from: '',
          effective_to: '',
        },
  });
  const errors = formState.errors;
  const scopeMode = watch('scope_mode');
  const clientId = watch('client_id');
  const productType = watch('product_type');
  // One product's own rate: only for a client (a product belongs to one client) and a type with products.
  const products = useClientProducts(clientId || undefined, !isEdit && scopeMode === 'specific' && !!clientId);
  const productOptions = [
    { value: ALL_PRODUCTS, label: 'Every product of this type' },
    ...(products.data ?? [])
      .filter((p) => p.product_type === productType && productType !== 'greenfield_internet')
      .map((p) => ({ value: p.id, label: p.name })),
  ];
  const productNames = useProductNames();
  // Edit shows the scope read-only (client_id is immutable, like product_type) — resolved for display only.
  const canViewClients = useCan('clients:view');
  const clients = useClients(canViewClients && isEdit);

  const onSubmit = (values: FormValues) => {
    if (isEdit && rate) {
      update.mutate(
        { id: rate.id, body: { amount: values.amount, effective_from: values.effective_from, effective_to: values.effective_to || undefined } },
        { onSuccess: () => { toast({ title: 'Rep rate updated', tone: 'success' }); onClose(); }, onError },
      );
      return;
    }
    create.mutate(
      {
        client_id: values.scope_mode === 'specific' ? values.client_id : undefined,
        product_type: values.product_type,
        product_id:
          values.scope_mode === 'specific' && values.product_id && values.product_id !== ALL_PRODUCTS ? values.product_id : undefined,
        amount: values.amount,
        effective_from: values.effective_from,
        effective_to: values.effective_to || undefined,
      },
      { onSuccess: () => { toast({ title: 'Rep rate added', tone: 'success' }); onClose(); }, onError },
    );
  };

  return (
    <Modal dirty={formState.isDirty} open={open} onOpenChange={(o) => !o && onClose()} title={isEdit ? 'Edit rep rate' : 'Add rep rate'}>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Banner tone="info" title="Effective-dated">
          {isEdit
            ? 'Only a pending rate can be edited; the product type, product and scope are fixed.'
            : 'A future-dated rate supersedes the pending one for the same type or product (within its own scope) and ends the current one.'}
        </Banner>
        {isEdit ? (
          <FormField label="Applies to">
            <span><Badge tone="neutral">{scopeLabel(rate!.client_id, clients.data)}</Badge></span>
          </FormField>
        ) : (
          <ClientScopeField
            control={control}
            modeName="scope_mode"
            clientName="client_id"
            mode={scopeMode}
            error={errors.client_id?.message}
            help="Global applies to every client. A client-scoped rate replaces it for that client's sales only."
          />
        )}
        {isEdit ? (
          <FormField label="Product type">
            <span><Badge tone="neutral">{productTypeLabel(rate!.product_type)}</Badge></span>
          </FormField>
        ) : (
          <Controller
            control={control}
            name="product_type"
            render={({ field }) => (
              <FormField
                label="Product type"
                required
                error={errors.product_type?.message}
                help="Greenfield internet sales are paid the Greenfield internet rate."
              >
                <Select
                  options={typeOptions}
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={types.isLoading ? 'Loading types…' : 'Select a type'}
                />
              </FormField>
            )}
          />
        )}
        {isEdit ? (
          <FormField label="Product">
            <span>
              <Badge tone="neutral">
                {rate!.product_id ? (productNames.get(rate!.product_id) ?? 'One product') : 'Every product of this type'}
              </Badge>
            </span>
          </FormField>
        ) : (
          scopeMode === 'specific' &&
          !!clientId &&
          !!productType &&
          productType !== 'greenfield_internet' && (
            <Controller
              control={control}
              name="product_id"
              render={({ field }) => (
                <FormField label="Product" help="Optional: a rate for one of this client's products. It wins over the type rate.">
                  <Select
                    options={productOptions}
                    value={field.value || ALL_PRODUCTS}
                    onValueChange={field.onChange}
                    aria-label="Product"
                  />
                </FormField>
              )}
            />
          )
        )}
        <FormField label="Rep rate" required error={errors.amount?.message} help="Paid to the rep per item, in full.">
          <MoneyInput {...register('amount')} placeholder="0.00" />
        </FormField>
        <div className={styles.dates}>
          <Controller
            control={control}
            name="effective_from"
            render={({ field }) => (
              <FormField label="Effective from" required error={errors.effective_from?.message}>
                <PayPeriodSelect value={field.value} onChange={field.onChange} aria-label="Effective from period" />
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="effective_to"
            render={({ field }) => (
              <FormField label="Effective to" help="Ends after the chosen period, or leave open-ended.">
                <PayPeriodSelect value={field.value} onChange={field.onChange} boundary="end" allowOpenEnded aria-label="Effective to period" />
              </FormField>
            )}
          />
        </div>
        <div className={styles.footer}>
          <ModalClose asChild>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </ModalClose>
          <Button variant="primary" type="submit" loading={create.isPending || update.isPending}>
            {isEdit ? 'Save changes' : 'Add rate'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
