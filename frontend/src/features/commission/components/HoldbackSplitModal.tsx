/**
 * HoldbackSplitModal — set a future-dated advance/holdback split (#10 supersession; back-date → 422). The
 * two fractions (0..1 decimal strings) must total exactly 100% — checked live via EXACT integer basis
 * points (no float, #1); the server re-validates (422). Tokens only.
 */
import { Check, X } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Banner, Button, FormField, Input, Modal, useToast } from '../../../components/ui';
import { cx } from '../../../components/ui';
import { PayPeriodSelect } from '../../../components/data/PayPeriodSelect';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useSetHoldback } from '../api/useCommissionMutations';
import { pctLabel, totalsToHundred } from '../pct';
import styles from './commission.module.css';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PCT = /^[01](\.\d{1,4})?$/;

const schema = z
  .object({
    advance_pct: z.string().regex(PCT, 'Fraction 0..1 (e.g. 0.70)'),
    holdback_pct: z.string().regex(PCT, 'Fraction 0..1 (e.g. 0.30)'),
    effective_from: z.string().regex(DATE, 'Date required').refine((d) => d >= todayIso(), 'Must be today or later'),
    effective_to: z.string().optional(),
  })
  .refine((v) => totalsToHundred(v.advance_pct, v.holdback_pct), {
    message: 'Advance + holdback must total 100%',
    path: ['holdback_pct'],
  });
type FormValues = z.infer<typeof schema>;

export function HoldbackSplitModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const set = useSetHoldback();
  const { control, register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { advance_pct: '0.70', holdback_pct: '0.30', effective_from: '', effective_to: '' },
  });
  const errors = formState.errors;
  const advance = useWatch({ control, name: 'advance_pct' }) ?? '';
  const holdback = useWatch({ control, name: 'holdback_pct' }) ?? '';
  const ok = totalsToHundred(advance, holdback);

  const onSubmit = (values: FormValues) =>
    set.mutate(
      { advance_pct: values.advance_pct, holdback_pct: values.holdback_pct, effective_from: values.effective_from, effective_to: values.effective_to || undefined },
      { onSuccess: () => { toast({ title: 'Holdback split set', tone: 'success' }); onClose(); }, onError },
    );

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Set holdback split">
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Banner tone="info" title="Effective-dated">
          A future-dated split supersedes the pending one and bounds the current.
        </Banner>
        <div className={styles.dates}>
          <FormField label="Advance fraction" required error={errors.advance_pct?.message} help={`= ${pctLabel(advance)}`}>
            <Input inputMode="decimal" {...register('advance_pct')} placeholder="0.70" />
          </FormField>
          <FormField label="Holdback fraction" required error={errors.holdback_pct?.message} help={`= ${pctLabel(holdback)}`}>
            <Input inputMode="decimal" {...register('holdback_pct')} placeholder="0.30" />
          </FormField>
        </div>
        <span className={cx(styles.total, ok ? styles.totalOk : styles.totalBad)}>
          {ok ? <Check size={15} /> : <X size={15} />} Total = {pctLabel(advance)} + {pctLabel(holdback)} {ok ? '= 100%' : '(must be 100%)'}
        </span>
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
          <Button variant="primary" type="submit" loading={set.isPending} disabled={!ok}>
            Set split
          </Button>
        </div>
      </form>
    </Modal>
  );
}
