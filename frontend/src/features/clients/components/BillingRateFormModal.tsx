/**
 * BillingRateFormModal — add a future-dated client billing rate, OR edit a PENDING one (#10). Adding a new
 * rate SUPERSEDES the scope's pending row and BOUNDS the current one (server-side); editing is restricted to
 * a pending rate and keeps the scope (rate_kind/product) fixed. `rate_kind='product'` requires a product
 * (server 422); back-dating is rejected (server 422) — surfaced as toasts. Money is an exact-decimal string
 * (MoneyInput). Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Badge, Banner, Button, FormField, Modal, MoneyInput, Select, useToast } from '../../../components/ui';
import { PayPeriodSelect } from '../../../components/data/PayPeriodSelect';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { useCreateBillingRate, useUpdateBillingRate } from '../api/useClientMutations';
import type { BillingRate, Product, RateKind } from '../clients.types';
import styles from './clients.module.css';

const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');

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
  currency,
  rate,
  onClose,
}: {
  open: boolean;
  clientId: string;
  products: Product[];
  /** The client's billing currency — the amount is entered in it (#12). */
  currency: string;
  /** When provided, the modal edits this PENDING rate (scope is fixed); otherwise it adds a new rate. */
  rate?: BillingRate;
  onClose: () => void;
}) {
  const isEdit = !!rate;
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateBillingRate();
  const update = useUpdateBillingRate();

  const { control, register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: rate
      ? {
          rate_kind: rate.rate_kind,
          product_id: rate.product_id ?? undefined,
          amount: rate.amount,
          effective_from: dateOnly(rate.effective_from),
          effective_to: dateOnly(rate.effective_to),
        }
      : { rate_kind: 'product', product_id: undefined, amount: '', effective_from: '', effective_to: '' },
  });
  const errors = formState.errors;
  const rateKind = useWatch({ control, name: 'rate_kind' });

  const onSubmit = (values: FormValues) => {
    if (isEdit && rate) {
      update.mutate(
        { clientId, rateId: rate.id, body: { amount: values.amount, effective_from: values.effective_from, effective_to: values.effective_to || undefined } },
        { onSuccess: () => { toast({ title: 'Billing rate updated', tone: 'success' }); onClose(); }, onError },
      );
      return;
    }
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
  };

  const productName = (id: string | null) => (id ? products.find((p) => p.id === id)?.name ?? id : '—');

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={isEdit ? 'Edit billing rate' : 'Add billing rate'}>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Banner tone="info" title="Effective-dated">
          {isEdit ? (
            <>Only a <strong>pending</strong> rate can be edited; its scope (rate kind / product) is fixed.</>
          ) : (
            <>A future-dated rate <strong>supersedes the scope&rsquo;s pending rate</strong> and <strong>bounds the current one</strong>. Closed periods are never changed.</>
          )}
        </Banner>

        {isEdit ? (
          <FormField label="Scope" help="Immutable — delete and re-add to change the scope.">
            <span className={styles.readonlyType}>
              <Badge tone="neutral">{RATE_KIND_OPTIONS.find((o) => o.value === rate!.rate_kind)?.label}</Badge>
              {rate!.rate_kind === 'product' && <Badge tone="neutral">{productName(rate!.product_id)}</Badge>}
            </span>
          </FormField>
        ) : (
          <Controller
            control={control}
            name="rate_kind"
            render={({ field }) => (
              <FormField label="Rate kind" required error={errors.rate_kind?.message}>
                <Select options={RATE_KIND_OPTIONS} value={field.value} onValueChange={field.onChange} />
              </FormField>
            )}
          />
        )}

        {!isEdit && rateKind === 'product' && (
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

        <FormField label={`Amount (${currency})`} required error={errors.amount?.message} help={`What this client is charged, in ${currency}.`}>
          <MoneyInput {...register('amount')} placeholder="0.00" currency={currency === 'CAD' ? undefined : `${currency} `} />
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
          <Button variant="primary" type="submit" loading={create.isPending || update.isPending}>
            {isEdit ? 'Save changes' : 'Add rate'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
