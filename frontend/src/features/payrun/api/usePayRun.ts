/**
 * Pay Run queries — READ-ONLY views over the orchestrator. Every number is server-computed; the UI never
 * does money math (#1/#5). Responses are `never`-typed in the contract → cast to the hand-written types.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { useServerTable } from '../../../lib/query/useServerTable';
import { payrunKeys } from './keys';
import type {
  PayPeriod,
  PayRun,
  PayRunFilters,
  PayRunPage,
  PayRunSummary,
  RepPayStatement,
  RepPayStatementSummary,
  RunRepSales,
} from '../payrun.types';

/** Array consumers read at most one capped page (the list is paginated, CLAUDE §13.4 ripple rule). */
const LOOKUP_LIMIT = 100;

/** The pre-loaded 2026 pay-period schedule (the period list + label lookups). */
export function usePayPeriods(enabled = true) {
  return useQuery({
    queryKey: payrunKeys.periods(),
    queryFn: () => unwrapList<PayPeriod>(api.GET('/v1/pay-periods')),
    enabled,
    staleTime: 5 * 60_000, // the schedule changes rarely
  });
}

/**
 * The newest pay-run headers as a plain ARRAY (capped at 100) — for dropdowns and lookups in other features.
 * The management history uses `usePayRunsTable`.
 */
export function usePayRuns(enabled = true) {
  return useQuery({
    queryKey: payrunKeys.runs(),
    queryFn: () => unwrapList<PayRunSummary>(api.GET('/v1/pay-runs', { params: { query: { limit: LOOKUP_LIMIT } } })),
    enabled,
  });
}

export type PayRunSortKey = 'created_at' | 'run_date' | 'status' | 'date_from' | 'date_to';

/** The commission-report history, server-paginated + sorted (legacy period runs and range reports). */
export function usePayRunsTable(filters: PayRunFilters, enabled = true) {
  return useServerTable<PayRunSummary, PayRunSortKey>({
    queryKey: (p) => payrunKeys.runsPage({ ...filters, ...p }),
    fetchPage: (p) => unwrap<PayRunPage>(api.GET('/v1/pay-runs', { params: { query: { ...filters, ...p } } })),
    defaultSort: { key: 'created_at', dir: 'desc' },
    newColumnDir: 'desc',
    filterKey: JSON.stringify(filters),
    limit: 20,
    enabled,
  });
}

/**
 * One rep's sales in a report — the per-sale drill-down. Paid: the frozen snapshots. Draft: the rate in
 * force (basis=estimated). Server-computed; the UI only displays it (#1/#2).
 */
export function useRunSales(runId: string | undefined, repId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: payrunKeys.runSales(runId ?? '', repId ?? ''),
    queryFn: () =>
      unwrap<RunRepSales>(
        api.GET('/v1/pay-runs/{id}/reps/{repId}/sales', { params: { path: { id: runId!, repId: repId! } } }),
      ),
    enabled: enabled && !!runId && !!repId,
  });
}

export interface LookupOption {
  id: string;
  code: string;
  name: string;
}

/** Clients for the report filter (capped). Read through the typed client, never another feature's internals. */
export function useReportClients(enabled = true) {
  return useQuery({
    queryKey: payrunKeys.lookups('clients'),
    queryFn: async () =>
      (
        await unwrapList<{ id: string; client_code: string; name: string }>(
          api.GET('/v1/clients', { params: { query: { status: 'all', limit: LOOKUP_LIMIT } } }),
        )
      ).map<LookupOption>((c) => ({ id: c.id, code: c.client_code, name: c.name })),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Reps (any status: a terminated rep can still be owed) for the report filter (capped). */
export function useReportReps(enabled = true) {
  return useQuery({
    queryKey: payrunKeys.lookups('reps'),
    queryFn: async () =>
      (
        await unwrapList<{ id: string; rep_code: string; full_name: string }>(
          api.GET('/v1/reps', { params: { query: { status: 'all', limit: LOOKUP_LIMIT, sort: 'full_name:asc' } } }),
        )
      ).map<LookupOption>((r) => ({ id: r.id, code: r.rep_code, name: r.full_name })),
    enabled,
    staleTime: 5 * 60_000,
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

/**
 * ONE rep's pay statement for a run — ADMIN path (payrun:view). A rep's own copy uses the self-scoped
 * endpoint, which takes no repId at all.
 */
export function useRepStatement(runId: string, repId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['payrun', 'rep-statement', runId, repId ?? 'none'],
    queryFn: () =>
      unwrap<RepPayStatement>(
        api.GET('/v1/pay-runs/{id}/reps/{repId}/statement', { params: { path: { id: runId, repId: repId! } } }),
      ),
    enabled: enabled && !!runId && !!repId,
  });
}

/** MY statements — own only; the rep comes from the token. */
export function useMyPayStatements(enabled = true) {
  return useQuery({
    queryKey: ['payrun', 'my-statements'],
    queryFn: () => unwrapList<RepPayStatementSummary>(api.GET('/v1/pay-statements')),
    enabled,
  });
}

/** MY statement for one run. */
export function useMyPayStatement(runId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['payrun', 'my-statement', runId ?? 'none'],
    queryFn: () => unwrap<RepPayStatement>(api.GET('/v1/pay-statements/{runId}', { params: { path: { runId: runId! } } })),
    enabled: enabled && !!runId,
  });
}
