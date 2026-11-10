/**
 * PeriodConfigModal — record a calendar shape. It moves NOTHING on its own; periods change only when an
 * admin then regenerates, which is the separate guarded action.
 *
 * The payday field appears for the PAY calendar only. A billing week has no payday — a bill is what the
 * client owes, not what a rep is paid — and the server 422s one rather than ignoring it, so the form does
 * not offer it (§14 rule 1).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Banner, Button, DatePicker, FormField, Input, Modal, Select, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useSetPeriodConfig } from '../api/usePeriodConfig';
import styles from './periodConfig.module.css';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  kind: z.enum(['pay', 'billing']),
  anchor_date: z.string().regex(DATE, 'Pick the first period start date'),
  length_days: z
    .string()
    .refine((v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 366, 'Between 1 and 366 days'),
  // A rep is never paid before the period closes, so this is never negative.
  payday_offset_days: z
    .string()
    .optional()
    .refine((v) => !v || (Number.isInteger(Number(v)) && Number(v) >= 0), '0 or more days after close'),
  effective_from: z.string().regex(DATE, 'Pick when this takes effect'),
});
type FormValues = z.infer<typeof schema>;

export function PeriodConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const save = useSetPeriodConfig();

  const { control, register, handleSubmit, formState, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: 'pay',
      anchor_date: '',
      length_days: '14',
      payday_offset_days: '13',
      effective_from: '',
    },
  });
  const errors = formState.errors;
  const kind = watch('kind');

  const onSubmit = (v: FormValues) =>
    save.mutate(
      {
        kind: v.kind,
        anchor_date: v.anchor_date,
        length_days: Number(v.length_days),
        // Omitted entirely for billing — sending it is a 422, and rightly so.
        ...(v.kind === 'pay' ? { payday_offset_days: Number(v.payday_offset_days || '0') } : {}),
        effective_from: v.effective_from,
      },
      {
        onSuccess: () => {
          toast({ title: 'Calendar shape saved — regenerate to apply it', tone: 'success' });
          onClose();
        },
        onError,
      },
    );

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Set a calendar shape"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="period-config-form" loading={save.isPending}>
            Save shape
          </Button>
        </div>
      }
    >
      <form id="period-config-form" className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Banner tone="info" title="This records intent only">
          Saving does not move any period. Regenerate afterwards to apply it to future periods.
        </Banner>

        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <FormField label="Calendar" required help="Pay periods govern rep pay; billing weeks govern what clients are billed.">
              <Select
                value={field.value}
                onValueChange={field.onChange}
                options={[
                  { value: 'pay', label: 'Pay periods' },
                  { value: 'billing', label: 'Billing weeks' },
                ]}
              />
            </FormField>
          )}
        />

        <Controller
          control={control}
          name="anchor_date"
          render={({ field }) => (
            <FormField
              label="Anchor date"
              required
              error={errors.anchor_date?.message}
              help="The first period's start date. Every later period is counted forward from here."
            >
              <DatePicker value={field.value} onChange={field.onChange} />
            </FormField>
          )}
        />

        <FormField
          label="Length (days)"
          required
          error={errors.length_days?.message}
          help="14 for a biweekly cycle, 7 for a weekly one."
        >
          <Input type="number" min={1} max={366} {...register('length_days')} />
        </FormField>

        {kind === 'pay' && (
          <FormField
            label="Payday offset (days after close)"
            error={errors.payday_offset_days?.message}
            help="How long after a period ends reps are paid. 0 means paid on close."
          >
            <Input type="number" min={0} {...register('payday_offset_days')} />
          </FormField>
        )}

        <Controller
          control={control}
          name="effective_from"
          render={({ field }) => (
            <FormField label="Effective from" required error={errors.effective_from?.message}>
              <DatePicker value={field.value} onChange={field.onChange} />
            </FormField>
          )}
        />
      </form>
    </Modal>
  );
}
