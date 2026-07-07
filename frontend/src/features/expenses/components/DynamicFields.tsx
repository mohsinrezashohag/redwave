/**
 * DynamicFields — renders a category's per-type CAPTURE fields (EXP-002a) from its config schema, bound to
 * `items.${index}.field_values.${key}`. Config-driven (text/textarea/number/money/date/select), NOT hardcoded.
 * A required field shows the required marker; the Alert engine (server + FE mirror) blocks save when missing.
 * These are METADATA ONLY — never summed into the amount (#1).
 */
import { Controller, useFormContext } from 'react-hook-form';
import { DatePicker, FormField, Input, MoneyInput, Select, Textarea } from '../../../components/ui';
import type { ExpenseFormValues } from './expenseForm.schema';
import type { ExpenseFieldDef } from '../expenses.types';

export function DynamicFields({ index, fields }: { index: number; fields: ExpenseFieldDef[] }) {
  const { control } = useFormContext<ExpenseFormValues>();
  if (fields.length === 0) return null;

  return (
    <>
      {fields.map((def) => (
        <Controller
          key={def.key}
          control={control}
          name={`items.${index}.field_values.${def.key}`}
          render={({ field, fieldState }) => (
            <FormField label={def.label} required={def.required} error={fieldState.error?.message}>
              {def.type === 'textarea' ? (
                <Textarea value={field.value ?? ''} onChange={field.onChange} placeholder={def.label} />
              ) : def.type === 'money' ? (
                <MoneyInput value={field.value ?? ''} onChange={field.onChange} placeholder="0.00" />
              ) : def.type === 'date' ? (
                <DatePicker value={field.value ?? ''} onChange={field.onChange} aria-label={def.label} />
              ) : def.type === 'select' ? (
                <Select
                  placeholder={`Select ${def.label.toLowerCase()}`}
                  options={(def.options ?? []).map((o) => ({ value: o, label: o }))}
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                />
              ) : (
                <Input
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  inputMode={def.type === 'number' ? 'numeric' : undefined}
                  placeholder={def.label}
                />
              )}
            </FormField>
          )}
        />
      ))}
    </>
  );
}
