/**
 * ExpenseForm — EDIT a single expense item (report-as-folder, EXP-001: item CREATION now happens inline
 * inside a folder, not here). RHF + zod over a single-item array so `ExpenseItemRow` (which reads
 * `items.${index}.*` from the form context) is reused unchanged. PATCH replaces the item; the km amount is
 * computed server-side. On success → the item detail. Tokens only.
 */
import { Save } from 'lucide-react';
import { useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Button, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useUpdateItem } from '../api/useExpenseMutations';
import { ExpenseItemRow } from './ExpenseItemRow';
import { useRoundTripConfirm } from './useRoundTripConfirm';
import { buildItemBody, makeExpenseSchema, type ExpenseFormValues, type ItemValue } from './expenseForm.schema';
import type { ExpenseItem, FieldConfig } from '../expenses.types';
import styles from './expenses.module.css';

/** Map an existing item → the single-item form values. */
function itemToValues(item: ExpenseItem): ExpenseFormValues {
  const base = {
    category: item.category,
    expense_date: item.expense_date.slice(0, 10),
    client_id: item.client_id ?? undefined,
    description: item.description,
    currency: item.original_currency ?? 'CAD',
    is_personal: item.is_personal,
    tags: item.tags ?? [],
    field_values: item.field_values ?? {},
  };
  const value: ItemValue =
    item.category === 'km' && item.km_log
      ? { ...base, trip_type: item.km_log.trip_type, total_km: item.km_log.total_km, stops: item.km_log.stops.map((s) => ({ address: s.address, lat: s.lat, lng: s.lng })) }
      : { ...base, amount: item.amount, receipt_url: item.receipt_url ?? undefined };
  return { items: [value] };
}

export function ExpenseForm({
  item,
  configs,
  clientOptions,
  onSaved,
}: {
  item: ExpenseItem;
  configs: FieldConfig[];
  clientOptions: { value: string; label: string }[];
  /** Called on a successful save instead of navigating (used by the inline folder-workspace edit). */
  onSaved?: (updated: ExpenseItem) => void;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const update = useUpdateItem();
  const resolver = useMemo(() => zodResolver(makeExpenseSchema(configs)), [configs]);

  const methods = useForm<ExpenseFormValues>({ resolver, defaultValues: itemToValues(item) });
  const { handleSubmit } = methods;
  const roundTrip = useRoundTripConfirm(configs);

  const save = (values: ExpenseFormValues) => {
    update.mutate(
      { id: item.id, body: buildItemBody(values) },
      {
        onSuccess: (updated) => {
          toast({ title: 'Expense updated', tone: 'success' });
          if (onSaved) onSaved(updated);
          else navigate(`/expenses/${updated.id}`);
        },
        onError,
      },
    );
  };
  // A round km trip asks first ("Yes, submit" / "Back to edit"). — meeting 2026-11-16
  const onSubmit = (values: ExpenseFormValues) => roundTrip.guard(values, () => save(values));

  return (
    <FormProvider {...methods}>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <ExpenseItemRow index={0} configs={configs} clientOptions={clientOptions} canRemove={false} onRemove={() => {}} />
        <div className={styles.footer}>
          {!onSaved && (
            <Button variant="secondary" type="button" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          )}
          <Button leftIcon={<Save size={16} />} variant="primary" type="submit" loading={update.isPending}>
            Save changes
          </Button>
        </div>
      </form>
      {roundTrip.dialog}
    </FormProvider>
  );
}
