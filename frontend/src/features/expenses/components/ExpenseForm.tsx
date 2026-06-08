/**
 * ExpenseForm — the weekly report entry/edit form (SRS EXP-001..005). RHF + zod + useFieldArray over the
 * items; categories come from the field configs (dynamic), the receipt rule is config-driven, and the km
 * amount is computed SERVER-SIDE (the form sends `km`, never `amount`, for km items). Handles create
 * (POST) and edit (PATCH, which replaces all items). On-behalf rep shows for admins/managers. Tokens only.
 */
import { useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { Controller, FormProvider, useFieldArray, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Button, Card, DatePicker, FormField, Select, useToast } from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useReps } from '../api/useLookups';
import { useCreateReport, useUpdateReport } from '../api/useExpenseMutations';
import { ExpenseItemRow } from './ExpenseItemRow';
import { blankItem, buildReportBody, makeExpenseSchema, type ExpenseFormValues, type ItemValue } from './expenseForm.schema';
import type { ExpenseReport, FieldConfig } from '../expenses.types';
import styles from './expenses.module.css';

const SELF = '__self__';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function isoFrom(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function currentWeekStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay()); // back to Sunday
  return isoFrom(d);
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoFrom(d);
}

/** Map an existing report → form values for editing. */
function reportToValues(report: ExpenseReport): ExpenseFormValues {
  return {
    week_start: report.week_start.slice(0, 10),
    week_end: report.week_end.slice(0, 10),
    rep_id: report.rep_id ?? '',
    items: report.expense_items.map((it): ItemValue => {
      if (it.category === 'km' && it.km_log) {
        return {
          category: 'km',
          expense_date: it.expense_date.slice(0, 10),
          client_id: it.client_id ?? undefined,
          description: it.description,
          trip_type: it.km_log.trip_type,
          total_km: it.km_log.total_km,
          stops: it.km_log.stops.map((s) => ({ address: s.address })),
        };
      }
      return {
        category: it.category,
        expense_date: it.expense_date.slice(0, 10),
        client_id: it.client_id ?? undefined,
        description: it.description,
        amount: it.amount,
        receipt_url: it.receipt_url ?? undefined,
      };
    }),
  };
}

export function ExpenseForm({
  mode,
  report,
  configs,
  clientOptions,
}: {
  mode: 'create' | 'edit';
  report?: ExpenseReport;
  configs: FieldConfig[];
  clientOptions: { value: string; label: string }[];
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const { isSuperAdmin, roles } = useAuth();
  const canSeeReps = useCan('hrm:view') && (isSuperAdmin || roles.includes('Admin') || roles.includes('Manager'));
  const reps = useReps(canSeeReps);

  const create = useCreateReport();
  const update = useUpdateReport();

  const requiresReceipt = useMemo(() => {
    const map = new Map(configs.map((c) => [c.category_key, c.requires_receipt]));
    return (category: string) => map.get(category) ?? false;
  }, [configs]);

  const defaults: ExpenseFormValues =
    mode === 'edit' && report
      ? reportToValues(report)
      : { week_start: currentWeekStart(), week_end: addDays(currentWeekStart(), 6), rep_id: '', items: [blankItem('', todayIso())] };

  const methods = useForm<ExpenseFormValues>({
    resolver: zodResolver(makeExpenseSchema(requiresReceipt)),
    defaultValues: defaults,
  });
  const { control, handleSubmit, formState } = methods;
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const onSubmit = (values: ExpenseFormValues) => {
    const body = buildReportBody(values);
    if (mode === 'edit' && report) {
      update.mutate(
        { id: report.id, body },
        {
          onSuccess: (r) => {
            toast({ title: 'Report updated', tone: 'success' });
            navigate(`/expenses/${r.id}`);
          },
          onError,
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: (r) => {
          toast({ title: 'Expenses submitted for the week', tone: 'success' });
          navigate(`/expenses/${r.id}`);
        },
        onError,
      });
    }
  };

  const itemsError = formState.errors.items?.message ?? (formState.errors.items?.root?.message as string | undefined);

  return (
    <FormProvider {...methods}>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Card title="Week">
          <div className={styles.reportRow}>
            <Controller
              control={control}
              name="week_start"
              render={({ field }) => (
                <FormField label="Week start" required error={formState.errors.week_start?.message}>
                  <DatePicker value={field.value ?? ''} onChange={field.onChange} invalid={!!formState.errors.week_start} aria-label="Week start" />
                </FormField>
              )}
            />
            <Controller
              control={control}
              name="week_end"
              render={({ field }) => (
                <FormField label="Week end" required error={formState.errors.week_end?.message}>
                  <DatePicker value={field.value ?? ''} onChange={field.onChange} invalid={!!formState.errors.week_end} aria-label="Week end" />
                </FormField>
              )}
            />
            {canSeeReps && (
              <Controller
                control={control}
                name="rep_id"
                render={({ field }) => (
                  <FormField label="Rep (on behalf of)" help="Defaults to you.">
                    <Select
                      options={[{ value: SELF, label: 'Myself' }, ...(reps.data ?? []).map((r) => ({ value: r.id, label: `${r.full_name} (${r.rep_code})` }))]}
                      value={field.value || SELF}
                      onValueChange={(v) => field.onChange(v === SELF ? '' : v)}
                    />
                  </FormField>
                )}
              />
            )}
          </div>
        </Card>

        <div className={styles.itemsHead}>
          <h3 className={styles.itemsTitle}>Items</h3>
          <Button variant="secondary" type="button" leftIcon={<Plus size={16} />} onClick={() => append(blankItem('', todayIso()))}>
            Add item
          </Button>
        </div>
        {itemsError && <p className={styles.itemsError}>{itemsError}</p>}

        {fields.map((f, i) => (
          <ExpenseItemRow
            key={f.id}
            index={i}
            configs={configs}
            clientOptions={clientOptions}
            canRemove={fields.length > 1}
            onRemove={() => remove(i)}
          />
        ))}

        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={() => navigate('/expenses')}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={create.isPending || update.isPending}>
            {mode === 'edit' ? 'Save changes' : 'Submit for the week'}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
