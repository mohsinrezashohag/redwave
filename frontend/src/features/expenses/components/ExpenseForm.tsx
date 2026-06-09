/**
 * ExpenseForm — the ITEM-FIRST add/edit form (SRS EXP-001..005). RHF + zod + useFieldArray over items.
 * CREATE adds one or several items at once ("Add another item") → POST /v1/expense-items; EDIT shows a
 * SINGLE item → PATCH /v1/expense-items/{id}. Categories come from the field configs (dynamic), the receipt
 * rule is config-driven, and the km amount is computed SERVER-SIDE (the form sends `km`, never `amount`, for
 * km items). On-behalf rep shows for admins/managers. Tokens only.
 */
import { useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { Controller, FormProvider, useFieldArray, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Button, Card, FormField, Select, useToast } from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useReps } from '../api/useLookups';
import { useCreateItems, useUpdateItem } from '../api/useExpenseMutations';
import { ExpenseItemRow } from './ExpenseItemRow';
import {
  blankItem,
  buildItemBody,
  buildItemsBody,
  makeExpenseSchema,
  type ExpenseFormValues,
  type ItemValue,
} from './expenseForm.schema';
import type { ExpenseItem, FieldConfig } from '../expenses.types';
import styles from './expenses.module.css';

const SELF = '__self__';

/** Map an existing item → form values (single item) for editing. */
function itemToValues(item: ExpenseItem): ExpenseFormValues {
  const base = {
    category: item.category,
    expense_date: item.expense_date.slice(0, 10),
    client_id: item.client_id ?? undefined,
    description: item.description,
  };
  const value: ItemValue =
    item.category === 'km' && item.km_log
      ? {
          ...base,
          trip_type: item.km_log.trip_type,
          total_km: item.km_log.total_km,
          stops: item.km_log.stops.map((s) => ({ address: s.address, lat: s.lat, lng: s.lng })),
        }
      : { ...base, amount: item.amount, receipt_url: item.receipt_url ?? undefined };
  return { rep_id: item.rep_id ?? '', items: [value] };
}

export function ExpenseForm({
  mode,
  item,
  configs,
  clientOptions,
}: {
  mode: 'create' | 'edit';
  item?: ExpenseItem;
  configs: FieldConfig[];
  clientOptions: { value: string; label: string }[];
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const { isSuperAdmin, roles } = useAuth();
  const canSeeReps = useCan('hrm:view') && (isSuperAdmin || roles.includes('Admin') || roles.includes('Manager'));
  const reps = useReps(canSeeReps);

  const create = useCreateItems();
  const update = useUpdateItem();

  const requiresReceipt = useMemo(() => {
    const map = new Map(configs.map((c) => [c.category_key, c.requires_receipt]));
    return (category: string) => map.get(category) ?? false;
  }, [configs]);

  const defaults: ExpenseFormValues =
    mode === 'edit' && item ? itemToValues(item) : { rep_id: '', items: [blankItem('', todayIso())] };

  const methods = useForm<ExpenseFormValues>({
    resolver: zodResolver(makeExpenseSchema(requiresReceipt)),
    defaultValues: defaults,
  });
  const { control, handleSubmit, formState } = methods;
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const onSubmit = (values: ExpenseFormValues) => {
    if (mode === 'edit' && item) {
      update.mutate(
        { id: item.id, body: buildItemBody(values) },
        {
          onSuccess: (updated) => {
            toast({ title: 'Expense updated', tone: 'success' });
            navigate(`/expenses/${updated.id}`);
          },
          onError,
        },
      );
    } else {
      create.mutate(buildItemsBody(values), {
        onSuccess: (created) => {
          toast({ title: `Added ${created.length} expense item(s)`, tone: 'success' });
          navigate('/expenses');
        },
        onError,
      });
    }
  };

  const itemsError = formState.errors.items?.message ?? (formState.errors.items?.root?.message as string | undefined);

  return (
    <FormProvider {...methods}>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        {canSeeReps && (
          <Card title="Rep">
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
          </Card>
        )}

        <div className={styles.itemsHead}>
          <h3 className={styles.itemsTitle}>{mode === 'edit' ? 'Expense item' : 'Items'}</h3>
          {mode === 'create' && (
            <Button variant="secondary" type="button" leftIcon={<Plus size={16} />} onClick={() => append(blankItem('', todayIso()))}>
              Add another item
            </Button>
          )}
        </div>
        {itemsError && <p className={styles.itemsError}>{itemsError}</p>}

        {fields.map((f, i) => (
          <ExpenseItemRow
            key={f.id}
            index={i}
            configs={configs}
            clientOptions={clientOptions}
            canRemove={mode === 'create' && fields.length > 1}
            onRemove={() => remove(i)}
          />
        ))}

        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={() => navigate('/expenses')}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={create.isPending || update.isPending}>
            {mode === 'edit' ? 'Save changes' : 'Add expense(s)'}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
