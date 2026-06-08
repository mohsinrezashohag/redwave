/**
 * FlatRateModal — add a future-dated flat rate per product_type (#10 supersession; back-date → 422). The
 * Select offers ONLY greenfield_internet / tv / home_phone — internet is tiered (set it in the tier
 * schedule); the server also 422s internet. Money exact-decimal via MoneyInput. Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Banner, Button, FormField, Modal, MoneyInput, Select, useToast } from '../../../components/ui';
import { PayPeriodSelect } from '../../../components/data/PayPeriodSelect';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { useCreateFlatRate } from '../api/useCommissionMutations';
import type { FlatProductType } from '../commission.types';
import styles from './commission.module.css';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
const FLAT_TYPES: FlatProductType[] = ['greenfield_internet', 'tv', 'home_phone'];

const schema = z.object({
  product_type: z.enum(['greenfield_internet', 'tv', 'home_phone']),
  amount: z.string().regex(MONEY, 'Enter an amount (max 2 dp)'),
  effective_from: z.string().regex(DATE, 'Date required').refine((d) => d >= todayIso(), 'Must be today or later'),
  effective_to: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function FlatRateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateFlatRate();
  const { control, register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { product_type: 'greenfield_internet', amount: '', effective_from: '', effective_to: '' },
  });
  const errors = formState.errors;

  const onSubmit = (values: FormValues) =>
    create.mutate(
      { product_type: values.product_type, amount: values.amount, effective_from: values.effective_from, effective_to: values.effective_to || undefined },
      { onSuccess: () => { toast({ title: 'Flat rate added', tone: 'success' }); onClose(); }, onError },
    );

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Add flat rate">
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Banner tone="info" title="Effective-dated">
          A future-dated rate supersedes the pending one for this product type and bounds the current.
        </Banner>
        <Controller
          control={control}
          name="product_type"
          render={({ field }) => (
            <FormField label="Product type" required error={errors.product_type?.message} help="Internet is tiered — set it in the tier schedule.">
              <Select options={FLAT_TYPES.map((t) => ({ value: t, label: productTypeLabel(t) }))} value={field.value} onValueChange={field.onChange} />
            </FormField>
          )}
        />
        <FormField label="Amount" required error={errors.amount?.message}>
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
          <Button variant="primary" type="submit" loading={create.isPending}>
            Add rate
          </Button>
        </div>
      </form>
    </Modal>
  );
}
