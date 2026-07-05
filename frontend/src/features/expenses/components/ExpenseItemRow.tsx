/**
 * ExpenseItemRow — one item card in the weekly report: a category Select (from the active field configs)
 * that branches to KmItemFields (km) or StandardItemFields (everything else). Changing the category resets
 * the category-specific fields (keeping date + description). Tokens only.
 */
import { Trash2 } from 'lucide-react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { FormField, IconButton, Input, Select, Switch } from '../../../components/ui';
import { todayIso } from '../../../lib/format/date';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { KmItemFields } from './KmItemFields';
import { StandardItemFields } from './StandardItemFields';
import { blankItem, type ExpenseFormValues } from './expenseForm.schema';
import type { FieldConfig } from '../expenses.types';
import styles from './expenses.module.css';

export function ExpenseItemRow({
  index,
  configs,
  clientOptions,
  onRemove,
  canRemove,
}: {
  index: number;
  configs: FieldConfig[];
  clientOptions: { value: string; label: string }[];
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { control, getValues, setValue } = useFormContext<ExpenseFormValues>();
  const category = useWatch({ control, name: `items.${index}.category` });
  const requiresReceipt = !!configs.find((c) => c.category_key === category)?.requires_receipt;
  const categoryOptions = configs.filter((c) => c.is_active).map((c) => ({ value: c.category_key, label: c.label }));
  // Per-item currency (km is always CAD server-side → the picker is locked for km).
  const currencies = useCurrencies();
  const isKm = category === 'km';
  const currentCurrency = useWatch({ control, name: `items.${index}.currency` });
  // Always include CAD + the item's current currency, so an edited foreign item's value still renders even
  // while the catalogue loads or the fetch fails — never a CAD-only list that drops the value (H1).
  const currencyOptions = (() => {
    const opts = new Map<string, string>([['CAD', 'CAD · Canadian Dollar']]);
    for (const c of currencies.data ?? []) opts.set(c.code, `${c.code} · ${c.name}`);
    if (currentCurrency && !opts.has(currentCurrency)) opts.set(currentCurrency, currentCurrency);
    return [...opts].map(([value, label]) => ({ value, label }));
  })();

  const changeCategory = (newCat: string) => {
    // Reset category-specific fields when the category changes (keep the date + description).
    const date = getValues(`items.${index}.expense_date`) || todayIso();
    const fresh = blankItem(newCat, date);
    fresh.description = getValues(`items.${index}.description`) || '';
    setValue(`items.${index}`, fresh, { shouldValidate: false });
  };

  return (
    <div className={styles.itemCard}>
      <div className={styles.itemTop}>
        <Controller
          control={control}
          name={`items.${index}.category`}
          render={({ field, fieldState }) => (
            <FormField label="Category" required error={fieldState.error?.message}>
              <Select
                placeholder="Pick a category"
                options={categoryOptions}
                value={field.value || undefined}
                onValueChange={changeCategory}
              />
            </FormField>
          )}
        />
        {canRemove && (
          <IconButton label="Remove item" icon={<Trash2 size={16} />} variant="outline" size="sm" onClick={onRemove} />
        )}
      </div>

      {category === 'km' ? (
        <KmItemFields index={index} />
      ) : (
        <StandardItemFields index={index} requiresReceipt={requiresReceipt} clientOptions={clientOptions} />
      )}

      {/* Common fields (all categories): currency (#12) + custom tags (EXP-002a) + personal toggle (EXP-012). */}
      <Controller
        control={control}
        name={`items.${index}.currency`}
        render={({ field }) => (
          <FormField
            label="Currency"
            help={isKm ? 'Kilometres are always reimbursed in CAD.' : 'A foreign amount freezes its CAD value at approval.'}
          >
            <Select
              options={currencyOptions}
              value={isKm ? 'CAD' : field.value || 'CAD'}
              onValueChange={field.onChange}
              disabled={isKm || currencies.isLoading}
            />
          </FormField>
        )}
      />
      <Controller
        control={control}
        name={`items.${index}.tags`}
        render={({ field }) => (
          <FormField label="Tags" help="Comma-separated (e.g. channel, campaign).">
            <Input
              value={(field.value ?? []).join(', ')}
              onChange={(e) =>
                field.onChange(
                  e.target.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                )
              }
              placeholder="e.g. door-to-door, spring-promo"
            />
          </FormField>
        )}
      />
      <Controller
        control={control}
        name={`items.${index}.is_personal`}
        render={({ field }) => (
          <Switch
            label="Personal (do not reimburse)"
            checked={!!field.value}
            onCheckedChange={(c) => field.onChange(c === true)}
          />
        )}
      />
    </div>
  );
}
