/**
 * Lookups — clients + reps + pay periods for the filter bar and the on-behalf selector. Same pattern as the
 * Sales hooks; kept self-contained in this feature (minimal types) rather than importing another feature's
 * internals. ARRAY reads go through `unwrapList` (normalizes the {data,meta} pagination envelope), so a
 * dropdown's `.map` never crashes. Gated by the caller on the relevant read permission.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrapList } from '../../../lib/query/unwrapList';
import { unwrap } from '../../../lib/query/unwrap';

export interface ClientLite {
  id: string;
  client_code: string;
  name: string;
}

export interface RepLite {
  id: string;
  rep_code: string;
  full_name: string;
  status: string;
}

export function useClients(enabled = true) {
  return useQuery({
    queryKey: ['clients', 'list'],
    // /v1/clients is paginated — unwrapList returns the row array for the dropdown (capped).
    queryFn: () => unwrapList<ClientLite>(api.GET('/v1/clients', { params: { query: { limit: 100 } } })),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useReps(enabled = true) {
  return useQuery({
    queryKey: ['reps', 'list'],
    // /v1/reps is the paginated {data,meta} envelope — unwrapList returns the rep array (was a crash site).
    queryFn: () => unwrapList<RepLite>(api.GET('/v1/reps')),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export interface PayPeriodLite {
  id: string;
  period_number: number;
  start_date: string;
  end_date: string;
}

/** Pay periods — for the export scope + the list's default "current cycle" date range. Gated payrun:view. */
export function usePayPeriods(enabled = true) {
  return useQuery({
    queryKey: ['pay-periods', 'list'],
    queryFn: () => unwrapList<PayPeriodLite>(api.GET('/v1/pay-periods')),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** The pay period whose [start,end] contains today (for the list's default date range). */
export function currentPeriod(periods: PayPeriodLite[] | undefined, todayIso: string): PayPeriodLite | undefined {
  return periods?.find((p) => p.start_date.slice(0, 10) <= todayIso && todayIso <= p.end_date.slice(0, 10));
}

/**
 * Org expense settings — the OFFICE the km policy says a trip runs from. Read is authenticated-only (no
 * permission): every rep's km form defaults its first stop to it. Cached long — it changes when the company
 * moves. — SRS EXP-004
 */
export interface ExpenseSettings {
  office_address: string | null;
  office_lat: string | null;
  office_lng: string | null;
}

export function useExpenseSettings(enabled = true) {
  return useQuery({
    queryKey: ['expense-settings'],
    queryFn: () => unwrap<ExpenseSettings>(api.GET('/v1/expense-settings')),
    enabled,
    staleTime: 30 * 60_000,
  });
}

/** The office as a km STOP, or null when no office is configured (then the rep types the origin). */
export function officeStop(settings: ExpenseSettings | undefined): { address: string; lat: string; lng: string } | null {
  if (!settings?.office_address) return null;
  return { address: settings.office_address, lat: settings.office_lat ?? '0', lng: settings.office_lng ?? '0' };
}
