/**
 * InlineAddItem — the inline "add an expense into this folder" form (report-as-folder, EXP-001). Reuses the
 * full item entry machinery (ExpenseItemRow + expenseForm.schema) inside a compact RHF host, and POSTs the
 * item into the folder as a DRAFT. On success it resets for the next item (fast multi-add) and notifies the
 * workspace. Tokens only.
 */
import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { Button, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useCreateItems } from '../api/useExpenseMutations';
import { ExpenseItemRow } from './ExpenseItemRow';
import { useRoundTripConfirm } from './useRoundTripConfirm';
import { blankItem, buildAddItemsBody, makeExpenseSchema, type ExpenseFormValues } from './expenseForm.schema';
import styles from './expenses.module.css';
import type { FieldConfig } from '../expenses.types';

export function InlineAddItem({
  reportId,
  configs,
  clientOptions,
  onDone,
  onCancel,
}: {
  reportId: string;
  configs: FieldConfig[];
  clientOptions: { value: string; label: string }[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateItems();
  const resolver = useMemo(() => zodResolver(makeExpenseSchema(configs)), [configs]);
  const methods = useForm<ExpenseFormValues>({ resolver, defaultValues: { items: [blankItem('', todayIso())] } });

  const roundTrip = useRoundTripConfirm(configs);

  const save = (values: ExpenseFormValues) => {
    create.mutate(buildAddItemsBody(reportId, values), {
      onSuccess: () => {
        toast({ title: 'Expense added', tone: 'success' });
        onDone();
      },
      onError,
    });
  };
  // A round km trip asks first ("Yes, submit" / "Back to edit"). — meeting 2026-11-16
  const onSubmit = (values: ExpenseFormValues) => roundTrip.guard(values, () => save(values));

  return (
    <FormProvider {...methods}>
      <form className={styles.form} onSubmit={methods.handleSubmit(onSubmit)} noValidate>
        <ExpenseItemRow index={0} configs={configs} clientOptions={clientOptions} canRemove={false} onRemove={() => {}} />
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={create.isPending}>
            Cancel
          </Button>
          <Button leftIcon={<Plus size={16} />} variant="primary" type="submit" loading={create.isPending}>
            Add expense
          </Button>
        </div>
      </form>
      {roundTrip.dialog}
    </FormProvider>
  );
}
