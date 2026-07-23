/**
 * Pay Run queries — READ-ONLY views over the orchestrator. Every number is server-computed; the UI never
 * does money math (#1/#5). Responses are `never`-typed in the contract → cast to the hand-written types.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { payrunKeys } from './keys';
import type {
  HoldbackFilters,
  HoldbackLedgerEntry,
  PayPeriod,
  PayRun,
  PayRunHoldbackSummary,
  PayRunSummary,
} from '../payrun.types';

/** The pre-loaded 2026 pay-period schedule (the period list + label lookups). */
export function usePayPeriods(enabled = true) {
  return useQuery({
    queryKey: payrunKeys.periods(),
    queryFn: () => unwrapList<PayPeriod>(api.GET('/v1/pay-periods')),
    enabled,
    staleTime: 5 * 60_000, // the schedule changes rarely
  });
}

/** All pay-run headers (not rep-scoped) — joined client-side with periods to derive each period's run state. */
export function usePayRuns(enabled = true) {
  return useQuery({
    queryKey: payrunKeys.runs(),
    queryFn: () => unwrapList<PayRunSummary>(api.GET('/v1/pay-runs')),
    enabled,
  });
}

/** A single run + its computed lines (lines are rep-scoped server-side). */
export function usePayRun(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: payrunKeys.run(id ?? ''),
    queryFn: () => unwrap<PayRun>(api.GET('/v1/pay-runs/{id}', { params: { path: { id: id as string } } })),
    enabled: enabled && !!id,
  });
}

/** Holdback ledger (rep-scoped server-side) — held vs released; raw IDs (label-joined in the UI). */
export function useHoldbackLedger(filters: HoldbackFilters = {}, enabled = true) {
  return useQuery({
    queryKey: payrunKeys.holdback(filters),
    queryFn: () => unwrapList<HoldbackLedgerEntry>(api.GET('/v1/holdback-ledger', { params: { query: filters } })),
    enabled,
  });
}

/**
 * The run's period-level 30% (deferred pay) view. Every total is computed SERVER-side — this hook exists
 * precisely so the UI never aggregates the holdback ledger itself.
 */
export function useHoldbackSummary(runId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: payrunKeys.holdbackSummary(runId ?? ''),
    queryFn: () =>
      unwrap<PayRunHoldbackSummary>(
        api.GET('/v1/pay-runs/{id}/holdback', { params: { path: { id: runId as string } } }),
      ),
    enabled: enabled && !!runId,
  });
}
