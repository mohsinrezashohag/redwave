/**
 * ClawbackEntryModal — record a recovery against ONE paid/frozen sale_item (SRS CLAW-001..006). The
 * recovery AMOUNT is the SERVER's: leaving it BLANK recovers the exact amount paid (the backend computes
 * rate + incentive off the frozen snapshot) — the UI shows the snapshot components read-only but NEVER sums
 * them (#1/#6). A value only overrides. The reported date is **informational** — no window is computed or
 * enforced (#6). The snapshot is never edited; a clawback is a new record (#2). Per-item — it does not touch
 * the internet activation or re-tier the period (#5).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Banner, Button, DatePicker, FormField, Modal, MoneyInput, Textarea, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { todayIso } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { useCreateClawback } from '../api/useClawbackMutations';
import styles from './clawback.module.css';
import type { SaleItem } from '../../sales/sales.types';

const MONEY = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  amount: z.string().refine((v) => v.trim() === '' || MONEY.test(v.trim()), 'Enter an amount (max 2 decimals) or leave blank'),
  reason: z.string().min(1, 'A reason is required').max(255),
  reported_date: z.string().regex(DATE, 'Date required'),
});
type Values = z.infer<typeof schema>;

interface Props {
  saleItem: SaleItem | null;
  saleCode?: string;
  onClose: () => void;
}

export function ClawbackEntryModal({ saleItem, saleCode, onClose }: Props) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateClawback();
  const { register, control, handleSubmit, formState, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    values: { amount: '', reason: '', reported_date: todayIso() },
  });

  const onSubmit = (values: Values) => {
    if (!saleItem) return;
    const amount = values.amount.trim();
    create.mutate(
      // amount OMITTED when blank → the server computes the exact amount paid from the snapshot (#1/#6).
      { sale_item_id: saleItem.id, reason: values.reason, reported_date: values.reported_date, ...(amount ? { amount } : {}) },
      {
        onSuccess: (cb) => {
          toast({ title: 'Clawback recorded', description: `Recovered ${money(cb.amount)} (${cb.status}).`, tone: 'success' });
          reset();
          onClose();
        },
        onError,
      },
    );
  };

  return (
    <Modal open={saleItem !== null} onOpenChange={(o) => !o && onClose()} title={saleItem ? `Claw back · ${productTypeLabel(saleItem.product_type)}` : 'Claw back'}>
      {saleItem && (
        <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
          <Banner tone="info" title="Per-item recovery — no re-tier">
            This recovers <strong>this item only</strong>. It does not touch the internet activation or re-tier the period (#5/#6).
          </Banner>

          <dl className={styles.snapshot}>
            {saleCode && (
              <>
                <dt>Sale</dt>
                <dd>{saleCode}</dd>
              </>
            )}
            <dt>Product</dt>
            <dd>{productTypeLabel(saleItem.product_type)}</dd>
            <dt>Rate applied</dt>
            <dd>{money(saleItem.rate_applied)}</dd>
            <dt>Incentive</dt>
            <dd>{money(saleItem.incentive_amount)}</dd>
          </dl>

          <FormField
            label="Recovery amount"
            error={formState.errors.amount?.message}
            help="Leave blank to recover the exact amount paid — the server computes it from the snapshot (rate + any incentive). Enter a value only to override."
          >
            <MoneyInput {...register('amount')} placeholder="Exact amount paid (default)" />
          </FormField>
          <FormField label="Reason" required error={formState.errors.reason?.message}>
            <Textarea {...register('reason')} placeholder="e.g. Customer cancelled — client reported." />
          </FormField>
          <Controller
            control={control}
            name="reported_date"
            render={({ field }) => (
              <FormField
                label="Client-reported date"
                required
                error={formState.errors.reported_date?.message}
                help="Informational only — it drives no logic; no cancellation window is computed or enforced (#6)."
              >
                <DatePicker value={field.value ?? ''} onChange={field.onChange} invalid={!!formState.errors.reported_date} aria-label="Client-reported date" />
              </FormField>
            )}
          />

          <div className={styles.footer}>
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={create.isPending}>
              Record clawback
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
