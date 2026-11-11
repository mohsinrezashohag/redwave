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
import { ClientScopeField } from './ClientScopeField';
import { DEFAULT_TIERS, buildTierBody, toBracketInputs, type TierFormValues } from './tierForm';
import styles from './commission.module.css';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z
  .object({
    scope_mode: z.enum(['all', 'specific']),
    client_id: z.string().optional(),
    effective_from: z.string().regex(DATE, 'Date required').refine((d) => d >= todayIso(), 'Must be today or later (no back-dating)'),
    effective_to: z.string(),
    tiers: z.array(
      z.object({ tier_number: z.string(), min_count: z.string(), max_count: z.string(), open: z.boolean(), rate_per_activation: z.string() }),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.scope_mode === 'specific' && !v.client_id) {
      ctx.addIssue({ code: 'custom', path: ['client_id'], message: 'Pick a client' });
    }
  });

export function TierScheduleModal({
  open,
  defaultClientId,
  onClose,
  endBasePrices = false,
}: {
  open: boolean;
  /** Pre-selects the scope from the page selector; undefined = the global row. */
  defaultClientId?: string;
  onClose: () => void;
  /** Turning tiers back ON from base prices: also end the scope's product base prices from the same date. */
  endBasePrices?: boolean;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateTierSchedule();

  const methods = useForm<TierFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      scope_mode: defaultClientId ? 'specific' : 'all',
      client_id: defaultClientId ?? '',
      effective_from: '',
      effective_to: '',
      tiers: DEFAULT_TIERS,
    },
  });
  const { control, handleSubmit, formState } = methods;
  const tiers = useWatch({ control, name: 'tiers' }) ?? [];
  const scopeMode = useWatch({ control, name: 'scope_mode' });
  const bracketError = validateTierBrackets(toBracketInputs(tiers));

  const onSubmit = (values: TierFormValues) => {
    if (validateTierBrackets(toBracketInputs(values.tiers))) return; // guarded by the disabled button
    create.mutate({ ...buildTierBody(values), ...(endBasePrices ? { end_product_base_prices: true } : {}) }, {
      onSuccess: () => { toast({ title: endBasePrices ? 'Tiers turned on' : 'Tier schedule added', tone: 'success' }); onClose(); },
      onError,
    });
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={endBasePrices ? 'Turn tiers on' : 'Add tier schedule'} size="lg">
      <FormProvider {...methods}>
        <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
          <Banner tone="info" title="Effective-dated">
            A future-dated schedule <strong>supersedes the pending one</strong> and <strong>bounds the
            current</strong> within its own scope. Closed periods are never recalculated. Schedules
            can&rsquo;t be edited, so add a new one instead. The engine determines tiers at runtime; this only stores
            the schedule.
          </Banner>

          {endBasePrices && (
            <Banner tone="warning" title="Product base prices end">
              From the period you pick, this scope pays by the tier ladder below. Its product base prices stop then;
              earlier periods keep what they were paid.
            </Banner>
          )}

          <ClientScopeField
            control={control}
            modeName="scope_mode"
            clientName="client_id"
            mode={scopeMode}
            error={formState.errors.client_id?.message}
            help="Global applies to every client. A client-scoped schedule replaces it for that client's sales only."
          />

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
                <FormField label="Effective to" help="Ends after the chosen period, or leave open-ended.">
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
