/**
 * TierScheduleModal — add a future-dated tier schedule (the #10 change path: a new schedule supersedes the
 * pending one + bounds the current; back-dating → 422). Owns the RHF form (effective dates + the bracket
 * field-array), runs the live contiguity mirror, and blocks submit until valid. The ENGINE determines tiers
 * at runtime; this only stores the schedule (#5). Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Banner, Button, FormField, Modal, useToast } from '../../../components/ui';
import { PayPeriodSelect } from '../../../components/data/PayPeriodSelect';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useCreateTierSchedule } from '../api/useCommissionMutations';
import { validateTierBrackets } from '../tiers.logic';
import { TierBracketEditor } from './TierBracketEditor';
import { DEFAULT_TIERS, buildTierBody, toBracketInputs, type TierFormValues } from './tierForm';
import styles from './commission.module.css';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  effective_from: z.string().regex(DATE, 'Date required').refine((d) => d >= todayIso(), 'Must be today or later (no back-dating)'),
  effective_to: z.string(),
  tiers: z.array(
    z.object({ tier_number: z.string(), min_count: z.string(), max_count: z.string(), open: z.boolean(), rate_per_activation: z.string() }),
  ),
});

export function TierScheduleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateTierSchedule();

  const methods = useForm<TierFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { effective_from: '', effective_to: '', tiers: DEFAULT_TIERS },
  });
  const { control, handleSubmit, formState } = methods;
  const tiers = useWatch({ control, name: 'tiers' }) ?? [];
  const bracketError = validateTierBrackets(toBracketInputs(tiers));

  const onSubmit = (values: TierFormValues) => {
    if (validateTierBrackets(toBracketInputs(values.tiers))) return; // guarded by the disabled button
    create.mutate(buildTierBody(values), {
      onSuccess: () => { toast({ title: 'Tier schedule added', tone: 'success' }); onClose(); },
      onError,
    });
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Add tier schedule" size="lg">
      <FormProvider {...methods}>
        <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
          <Banner tone="info" title="Effective-dated">
            A future-dated schedule <strong>supersedes the pending one</strong> and <strong>bounds the
            current</strong>. Closed periods are never recomputed; schedules can&rsquo;t be edited — add a new
            one. The engine determines tiers at runtime; this only stores the schedule.
          </Banner>

          <div className={styles.dates}>
            <Controller
              control={control}
              name="effective_from"
              render={({ field }) => (
                <FormField label="Effective from" required error={formState.errors.effective_from?.message}>
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

          <TierBracketEditor error={bracketError} />

          <div className={styles.footer}>
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={create.isPending} disabled={bracketError !== null}>
              Add schedule
            </Button>
          </div>
        </form>
      </FormProvider>
    </Modal>
  );
}
