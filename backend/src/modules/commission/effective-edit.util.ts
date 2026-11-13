/**
 * Shared helpers for EDIT/DELETE of effective-dated commission config (rep rates). Only PENDING rows may be edited or deleted; a current/past row is immutable (supersede instead).
 * — CLAUDE §3 #10
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { dateOnly, deriveStatus, toUtcDateOnly } from '../../common/effective-dating';
import { winnipegDateOnly } from '../../common/timezone';

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Throw 422 unless the row is pending (not yet in force). Status matches what the list endpoints show. */
export function assertPending(row: { effective_from: Date; effective_to: Date | null }): void {
  // deriveStatus only reads the effective window; the id is irrelevant to the status.
  if (deriveStatus({ id: '', ...row }, toUtcDateOnly(new Date())) !== 'pending') {
    throw new UnprocessableEntityException(
      'Only a pending (not-yet-effective) row can be edited/deleted; supersede a current/past row instead',
    );
  }
}

/** Resolve + validate the edited effective window for a pending row (back-dating → 422). */
export function resolveEditWindow(
  existing: { effective_from: Date; effective_to: Date | null },
  dto: { effective_from?: string; effective_to?: string },
): { from: Date; to: Date | null; today: Date } {
  const fromIso = dto.effective_from ?? isoDate(existing.effective_from);
  const toIso =
    dto.effective_to !== undefined ? dto.effective_to : existing.effective_to ? isoDate(existing.effective_to) : null;
  const from = dateOnly(fromIso);
  const to = toIso ? dateOnly(toIso) : null;
  const today = winnipegDateOnly();
  if (from.getTime() < today.getTime()) {
    throw new UnprocessableEntityException('effective_from cannot be in the past');
  }
  if (to && to.getTime() < from.getTime()) {
    throw new UnprocessableEntityException('effective_to cannot be before effective_from');
  }
  return { from, to, today };
}
