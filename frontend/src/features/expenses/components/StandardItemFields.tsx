/**
 * StandardItemFields — the non-km item sub-form: date + amount (MoneyInput) + description + receipt. The
 * receipt is REQUIRED when the category config says so (config-driven, EXP-003); the server is the real
 * gate. The Client tag is a COMMON field (lifted to ExpenseItemRow so km items get it too). Uses the form
 * context. Tokens only.
 */
import { Controller, useFormContext } from 'react-hook-form';
import { DatePicker, FormField, Input, MoneyInput } from '../../../components/ui';
import { ReceiptField } from './ReceiptField';
import type { ExpenseFormValues } from './expenseForm.schema';
import styles from './expenses.module.css';

export function StandardItemFields({
  index,
  requiresReceipt,
  requiresDescription,
}: {
  index: number;
  requiresReceipt: boolean;
  requiresDescription: boolean;
}) {
  const { control, register, formState } = useFormContext<ExpenseFormValues>();
  const itemErrors = formState.errors.items?.[index];

  return (
    <>
      <div className={styles.itemGrid}>
        <Controller
          control={control}
          name={`items.${index}.expense_date`}
          render={({ field }) => (
            <FormField label="Date" required error={itemErrors?.expense_date?.message}>
              <DatePicker value={field.value ?? ''} onChange={field.onChange} invalid={!!itemErrors?.expense_date} aria-label="Expense date" />
            </FormField>
          )}
        />
        <FormField label="Amount" required error={itemErrors?.amount?.message}>
          <MoneyInput {...register(`items.${index}.amount`)} placeholder="0.00" />
        </FormField>
      </div>

      {/* Both of these are CONFIG-DRIVEN per category, not hard-coded: a category whose name already says
          what the item is (Meals) asks for neither. The copy says so warmly rather than just dropping the
          asterisk — an unexplained missing "*" reads as a bug, not as permission. */}
      <FormField
        label="Description"
        required={requiresDescription}
        error={itemErrors?.description?.message}
        help={requiresDescription ? undefined : 'Optional — add a note only if it helps explain the expense.'}
      >
        <Input placeholder={requiresDescription ? 'Lunch with client' : 'Optional note'} {...register(`items.${index}.description`)} />
      </FormField>

      <Controller
        control={control}
        name={`items.${index}.receipt_url`}
        render={({ field, fieldState }) => (
          <FormField
            label="Receipt"
            required={requiresReceipt}
            error={fieldState.error?.message}
            help={
              requiresReceipt
                ? 'Mandatory for this category.'
                : 'Optional — attach one if you have it. No problem if there isn’t one (a home-made meal, or a vendor that gives none).'
            }
          >
            <ReceiptField value={field.value} onChange={field.onChange} />
          </FormField>
        )}
      />
    </>
  );
}
