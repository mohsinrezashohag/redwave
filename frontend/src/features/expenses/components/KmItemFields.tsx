/**
 * KmItemFields — the km item sub-form (SRS EXP-004). Trip type (single −30 / round −60), reorderable
 * address stops (≥2; lat/lng stubbed '0', no geocoder), and the total distance. A LIVE INDICATIVE billable
 * preview (kmPreview) shows for UX — but the server computes the authoritative amount, so no `amount` is
 * sent for km. Uses the form context + a nested field array for stops. Tokens only.
 */
import { useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Button, DatePicker, FormField, IconButton, Input, RadioGroup } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import { kmPreview } from '../km';
import type { TripType } from '../expenses.types';
import type { ExpenseFormValues } from './expenseForm.schema';
import styles from './expenses.module.css';

const TRIP_OPTIONS = [
  { value: 'single', label: 'Single trip (−30 km)' },
  { value: 'round', label: 'Round trip (−60 km)' },
];

export function KmItemFields({ index }: { index: number }) {
  const { control, register, getValues, setValue, formState } = useFormContext<ExpenseFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: `items.${index}.stops` as const });
  const itemErrors = formState.errors.items?.[index];

  useEffect(() => {
    if (!getValues(`items.${index}.trip_type`)) setValue(`items.${index}.trip_type`, 'round');
    const stops = getValues(`items.${index}.stops`) ?? [];
    for (let k = stops.length; k < 2; k++) append({ address: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalKm = useWatch({ control, name: `items.${index}.total_km` });
  const trip = (useWatch({ control, name: `items.${index}.trip_type` }) ?? 'round') as TripType;
  const preview = kmPreview(totalKm, trip);
  const stopsError = (itemErrors?.stops as { message?: string } | undefined)?.message;

  return (
    <>
      <Controller
        control={control}
        name={`items.${index}.expense_date`}
        render={({ field }) => (
          <FormField label="Date" required error={itemErrors?.expense_date?.message}>
            <DatePicker value={field.value ?? ''} onChange={field.onChange} invalid={!!itemErrors?.expense_date} aria-label="Expense date" />
          </FormField>
        )}
      />

      <Controller
        control={control}
        name={`items.${index}.trip_type`}
        render={({ field, fieldState }) => (
          <FormField label="Trip type" required error={fieldState.error?.message}>
            <RadioGroup options={TRIP_OPTIONS} value={field.value} onValueChange={field.onChange} ariaLabel="Trip type" />
          </FormField>
        )}
      />

      <FormField label="Stops" required error={stopsError}>
        <div className={styles.stops}>
          {fields.map((f, k) => (
            <div className={styles.stopRow} key={f.id}>
              <span className={styles.stopOrder}>{k + 1}</span>
              <Input className={styles.stopAddress} placeholder="123 Main St, Winnipeg" {...register(`items.${index}.stops.${k}.address`)} />
              <IconButton
                label="Remove stop"
                icon={<Trash2 size={15} />}
                variant="outline"
                size="sm"
                disabled={fields.length <= 2}
                onClick={() => remove(k)}
              />
            </div>
          ))}
          <Button variant="tertiary" size="sm" type="button" leftIcon={<Plus size={14} />} onClick={() => append({ address: '' })}>
            Add stop
          </Button>
        </div>
      </FormField>

      <FormField label="Total distance (km)" required error={itemErrors?.total_km?.message} help="Total driven distance for the day.">
        <Input inputMode="decimal" placeholder="130" {...register(`items.${index}.total_km`)} />
      </FormField>

      <FormField label="Description" required error={itemErrors?.description?.message}>
        <Input placeholder="Client visits" {...register(`items.${index}.description`)} />
      </FormField>

      <div className={styles.preview}>
        <span className={`${styles.previewAmount} mono`}>{preview.valid ? money(preview.amount) : '—'}</span>
        <span className={styles.previewNote}>
          {preview.valid
            ? `${preview.billableKm} km billable × $0.45 — indicative; the server computes the final amount`
            : 'Enter total km to preview the billable amount'}
        </span>
      </div>
    </>
  );
}
