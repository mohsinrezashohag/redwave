/**
 * useRoundTripConfirm — the "is this really a round trip?" check before saving a km item (client meeting
 * 2026-11-16: "Popup (round trip): yes / back to edit"). A round trip measures the closed loop (the drive
 * back to the first stop is added, SRS EXP-004) and takes the larger 60 km deduction, so a rep who meant a
 * single trip would be paid for the wrong distance. The prompt runs at ITEM SAVE (add or edit), the one
 * place "Back to edit" can return the rep to the fields; folder submit does not ask again (no double prompt).
 *
 * Mileage is decided by the category BEHAVIOUR (like validation.ts), falling back to the `km` key only when
 * no config resolved. Neutral styling: this is a check, not a destructive action. Tokens only (via the
 * shared ConfirmDialog).
 *
 *   const { guard, dialog } = useRoundTripConfirm(configs);
 *   onSubmit = (values) => guard(values, () => save(values));   …render {dialog} once.
 */
import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../../../components/ui';
import type { FieldConfig } from '../expenses.types';
import type { ExpenseFormValues } from './expenseForm.schema';

/** True when any item in the form is a km-behaviour item marked as a round trip. Pure, exported for tests. */
export function hasRoundTrip(values: ExpenseFormValues, configs: FieldConfig[]): boolean {
  return values.items.some((it) => {
    const cfg = configs.find((c) => c.category_key === it.category);
    const isKm = cfg ? cfg.behaviour === 'km' : it.category === 'km';
    return isKm && it.trip_type === 'round';
  });
}

export function useRoundTripConfirm(configs: FieldConfig[]): {
  guard: (values: ExpenseFormValues, proceed: () => void) => void;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<(() => void) | null>(null);

  const guard = (values: ExpenseFormValues, proceed: () => void) => {
    if (hasRoundTrip(values, configs)) setPending(() => proceed);
    else proceed();
  };

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(o) => !o && setPending(null)}
      title="Confirm round trip"
      description="This trip returns to the first stop, so the route counts the drive back and 60 km is deducted. Is that right?"
      confirmLabel="Yes, submit"
      cancelLabel="Back to edit"
      destructive={false}
      onConfirm={() => {
        const run = pending;
        setPending(null);
        run?.();
      }}
    />
  );

  return { guard, dialog };
}
