/**
 * BillingRateFormModal — add a future-dated client billing rate (the effective-dating change path, #10).
 * There is no edit/delete: a new rate SUPERSEDES the scope's pending row and BOUNDS the current one
 * (server-side). `rate_kind='product'` requires a product (server 422 otherwise); back-dating is rejected
 * (server 422) — both surfaced as toasts. Money is an exact-decimal string (MoneyInput). Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Banner, Button, FormField, Modal, MoneyInput, Select, useToast } from '../../../components/ui';
import { PayPeriodSelect } from '../../../components/data/PayPeriodSelect';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { useCreateBillingRate } from '../api/useClientMutations';
import type { Product, RateKind } from '../clients.types';
import styles from './clients.module.css';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;

const RATE_KIND_OPTIONS: { value: RateKind; label: string }[] = [
  { value: 'product', label: 'Product rate' },
  { value: 'tv_addon', label: 'TV add-on' },
  { value: 'hp_addon', label: 'Home-phone add-on' },
  { value: 'bundle_bonus', label: 'Bundle bonus' },
  { value: 'spiff', label: 'Spiff' },
];

const schema = z
  .object({
    rate_kind: z.enum(['product', 'tv_addon', 'hp_addon', 'bundle_bonus', 'spiff']),
    product_id: z.string().optional(),
    amount: z.string().regex(MONEY, 'Enter an amount (max 2 dp)'),
    effective_from: z.string().regex(DATE, 'Date required'),
    effective_to: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.rate_kind === 'product' && !val.product_id) {
      ctx.addIssue({ code: 'custom', path: ['product_id'], message: 'A product is required for a product rate' });
    }
    if (val.effective_from < todayIso()) {
      ctx.addIssue({ code: 'custom', path: ['effective_from'], message: 'Must be today or later (no back-dating)' });
    }
    if (val.effective_to && val.effective_to < val.effective_from) {
      ctx.addIssue({ code: 'custom', path: ['effective_to'], message: 'Must be on or after the start date' });
    }
  });
type FormValues = z.infer<typeof schema>;

export function BillingRateFormModal({
  open,
  clientId,
  products,
  onClose,
}: {
  open: boolean;
  clientId: string;
  products: Product[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateBillingRate();

  const { control, register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { rate_kind: 'product', product_id: undefined, amount: '', effective_from: '', effective_to: '' },
  });
  const errors = formState.errors;
  const rateKind = useWatch({ control, name: 'rate_kind' });

  const onSubmit = (values: FormValues) =>
    create.mutate(
      {
        clientId,
        body: {
          rate_kind: values.rate_kind,
          product_id: values.rate_kind === 'product' ? values.product_id : undefined,
          amount: values.amount,
          effective_from: values.effective_from,
          effective_to: values.effective_to || undefined,
        },
      },
      {
        onSuccess: () => { toast({ title: 'Billing rate added', tone: 'success' }); onClose(); },
        onError,
      },
    );

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Add billing rate">
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Banner tone="info" title="Effective-dated">
          A future-dated rate <strong>supersedes the scope&rsquo;s pending rate</strong> and{' '}
          <strong>bounds the current one</strong>. Closed periods are never changed; existing rows can&rsquo;t
          be edited — add a new one to change a rate.
        </Banner>

        <Controller
          control={control}
          name="rate_kind"
          render={({ field }) => (
            <FormField label="Rate kind" required error={errors.rate_kind?.message}>
              <Select options={RATE_KIND_OPTIONS} value={field.value} onValueChange={field.onChange} />
            </FormField>
          )}
        />

        {rateKind === 'product' && (
          <Controller
            control={control}
            name="product_id"
            render={({ field }) => (
              <FormField label="Product" required error={errors.product_id?.message}>
                <Select
                  placeholder="Select a product"
                  options={products.map((p) => ({ value: p.id, label: `${p.name} · ${productTypeLabel(p.product_type)}` }))}
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                />
              </FormField>
            )}
          />
        )}

        <FormField label="Amount" required error={errors.amount?.message}>
          <MoneyInput {...register('amount')} placeholder="0.00" />
        </FormField>

        <Controller
          control={control}
          name="effective_from"
          render={({ field }) => (
            <FormField label="Effective from" required error={errors.effective_from?.message} help="Takes effect at the start of the chosen pay period (the server rejects back-dating).">
              <PayPeriodSelect value={field.value} onChange={field.onChange} aria-label="Effective from period" />
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="effective_to"
          render={({ field }) => (
            <FormField label="Effective to" error={errors.effective_to?.message} help="Ends after the chosen period — or open-ended.">
              <PayPeriodSelect value={field.value} onChange={field.onChange} boundary="end" allowOpenEnded aria-label="Effective to period" />
            </FormField>
          )}
        />

        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={create.isPending}>
            Add rate
          </Button>
        </div>
      </form>
    </Modal>
  );
}
