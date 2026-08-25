/**
 * TierRateModal — add or edit a future-dated PER-PRODUCT tier rate (#10 supersession; back-date → 422).
 *
 * What this configures is narrow on purpose: what ONE bracket pays for ONE product. It does not touch the
 * tally or the bracket boundaries — those stay on the tier schedule and still decide which tier every
 * product lands in (#5). A product with no rate here keeps the schedule's own rate, which is why the form
 * says so rather than implying the field is required for the product to be paid.
 *
 * The client is chosen FIRST and only narrows the product list: a product belongs to exactly one client, so
 * picking the product already determines the client. The server 422s a mismatch rather than storing a rate
 * that could never resolve. Money is an exact decimal via MoneyInput (#1). Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge, Banner, Button, FormField, Modal, MoneyInput, Select, useToast } from '../../../components/ui';
import { PayPeriodSelect } from '../../../components/data/PayPeriodSelect';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useClientProducts } from '../../clients/api/useClients';
import { useCreateTierRate, useUpdateTierRate } from '../api/useCommissionMutations';
import { useClients, useTierSchedules } from '../api/useCommission';
import type { TierBracket, TierRate } from '../commission.types';
import styles from './commission.module.css';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');

const schema = z.object({
  client_id: z.string().min(1, 'Pick a client'),
  product_id: z.string().min(1, 'Pick a product'),
  tier_number: z.string().min(1, 'Pick a tier'),
  amount: z.string().regex(MONEY, 'Enter an amount (max 2 dp)'),
  effective_from: z.string().regex(DATE, 'Date required').refine((d) => d >= todayIso(), 'Must be today or later'),
  effective_to: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function TierRateModal({
  open,
  rate,
  defaultClientId,
  onClose,
}: {
  open: boolean;
  rate?: TierRate;
  defaultClientId?: string;
  onClose: () => void;
}) {
  const isEdit = !!rate;
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateTierRate();
  const update = useUpdateTierRate();
  const clients = useClients(true);

  const { control, register, handleSubmit, formState, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: rate
      ? {
          client_id: rate.client_id ?? '',
          product_id: rate.product_id,
          tier_number: String(rate.tier_number),
          amount: rate.amount,
          effective_from: dateOnly(rate.effective_from),
          effective_to: dateOnly(rate.effective_to),
        }
      : {
          client_id: defaultClientId ?? '',
          product_id: '',
          tier_number: '',
          amount: '',
          effective_from: '',
          effective_to: '',
        },
  });
  const errors = formState.errors;
  const clientId = watch('client_id');

  // Only the chosen client's TIERED products can carry a tier rate — an add-on is flat-rated, and the
  // server 422s one, so it is never offered here.
  const products = useClientProducts(clientId || undefined, !isEdit && !!clientId);
  const tieredProducts = (products.data ?? []).filter((p) => p.product_type === 'internet');

  // The brackets that actually exist, so a rate can never be written for a tier no tally could reach.
  // Shows the count range beside each tier, because "Tier 2" alone does not say what earns it.
  const schedules = useTierSchedules(clientId || undefined);
  const tierOptions = (schedules.data?.[0]?.tiers ?? []).map((t: TierBracket) => ({
    value: String(t.tier_number),
    label: `Tier ${t.tier_number} — ${t.min_count}${t.max_count === null ? '+' : `–${t.max_count}`} activations`,
  }));

  const onSubmit = (values: FormValues) => {
    if (isEdit && rate) {
      update.mutate(
        {
          id: rate.id,
          body: {
            amount: values.amount,
            effective_from: values.effective_from,
            effective_to: values.effective_to || undefined,
          },
        },
        { onSuccess: () => { toast({ title: 'Tier rate updated', tone: 'success' }); onClose(); }, onError },
      );
      return;
    }
    create.mutate(
      {
        client_id: values.client_id,
        product_id: values.product_id,
        tier_number: Number(values.tier_number),
        amount: values.amount,
        effective_from: values.effective_from,
        effective_to: values.effective_to || undefined,
      },
      { onSuccess: () => { toast({ title: 'Tier rate added', tone: 'success' }); onClose(); }, onError },
    );
  };

  const clientName = (id: string | null) =>
    clients.data?.find((c) => c.id === id)?.name ?? id ?? 'Every client';

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={isEdit ? 'Edit product rate' : 'Add product rate'}
    >
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Banner tone="info" title="This sets the RATE, not the tier">
          {isEdit
            ? 'Only a pending rate can be edited; the product and tier are fixed.'
            : 'The activation count still decides which tier a period lands in — this only changes what that tier pays for this product. A product with no rate here is paid the schedule rate.'}
        </Banner>

        {isEdit ? (
          <>
            <FormField label="Client">
              <span><Badge tone="neutral">{clientName(rate!.client_id)}</Badge></span>
            </FormField>
            <FormField label="Product">
              <span><Badge tone="neutral">{rate!.product?.name ?? rate!.product_id}</Badge></span>
            </FormField>
            <FormField label="Tier">
              <span><Badge tone="neutral">Tier {rate!.tier_number}</Badge></span>
            </FormField>
          </>
        ) : (
          <>
            <Controller
              control={control}
              name="client_id"
              render={({ field }) => (
                <FormField label="Client" required error={errors.client_id?.message} help="Narrows the products below.">
                  <Select
                    options={(clients.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.client_code})` }))}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={clients.isLoading ? 'Loading clients…' : 'Select a client'}
                  />
                </FormField>
              )}
            />
            <Controller
              control={control}
              name="product_id"
              render={({ field }) => (
                <FormField
                  label="Product"
                  required
                  error={errors.product_id?.message}
                  help="Tiered products only — an add-on is priced by a flat rate."
                >
                  <Select
                    options={tieredProducts.map((p) => ({ value: p.id, label: p.name }))}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={
                      !clientId
                        ? 'Pick a client first'
                        : products.isLoading
                          ? 'Loading products…'
                          : tieredProducts.length === 0
                            ? 'No tiered products for this client'
                            : 'Select a product'
                    }
                    disabled={!clientId || tieredProducts.length === 0}
                  />
                </FormField>
              )}
            />
            <Controller
              control={control}
              name="tier_number"
              render={({ field }) => (
                <FormField label="Tier" required error={errors.tier_number?.message}>
                  <Select
                    options={tierOptions}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={schedules.isLoading ? 'Loading tiers…' : 'Select a tier'}
                  />
                </FormField>
              )}
            />
          </>
        )}

        <FormField label="Amount per activation" required error={errors.amount?.message}>
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
              <FormField label="Effective to" help="Ends after the chosen period — or open-ended.">
                <PayPeriodSelect value={field.value} onChange={field.onChange} boundary="end" allowOpenEnded aria-label="Effective to period" />
              </FormField>
            )}
          />
        </div>
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
