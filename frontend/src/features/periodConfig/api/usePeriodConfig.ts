/**
 * Period-config hooks — the pay and billing CALENDARS as admin configuration.
 *
 * Note the split between preview and apply: `usePreviewRegeneration` writes nothing and is what the screen
 * shows before anything happens, while `useRegenerate` is the guarded action. They share one planner
 * server-side, so the preview cannot disagree with the outcome.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import type {
  CalendarOverlap,
  PeriodConfig,
  PeriodKind,
  RegenerationPlan,
  SetPeriodConfigBody,
} from '../periodConfig.types';

export const periodConfigKeys = {
  all: ['period-configs'] as const,
  list: () => ['period-configs', 'list'] as const,
  overlap: (payPeriodNumber: number) => ['period-configs', 'overlap', payPeriodNumber] as const,
};

export function usePeriodConfigs(enabled = true) {
  return useQuery({
    queryKey: periodConfigKeys.list(),
    queryFn: () => unwrapList<PeriodConfig>(api.GET('/v1/period-configs')),
    enabled,
  });
}

export function useSetPeriodConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetPeriodConfigBody) =>
      unwrap<PeriodConfig>(api.POST('/v1/period-configs', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: periodConfigKeys.all }),
  });
}

/** Writes nothing — what an admin sees before deciding. */
export function usePreviewRegeneration() {
  return useMutation({
    mutationFn: ({ kind, count }: { kind: PeriodKind; count: number }) =>
      unwrap<RegenerationPlan>(api.POST('/v1/period-configs/regenerate/preview', { body: { kind, count } })),
  });
}

/** The guarded action. A 422 carries `blocked[]` naming each frozen period and its document. */
export function useRegenerate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, count }: { kind: PeriodKind; count: number }) =>
      unwrap<RegenerationPlan>(api.POST('/v1/period-configs/regenerate', { body: { kind, count } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: periodConfigKeys.all });
      // Periods moved — anything that lists or derives them is now stale.
      qc.invalidateQueries({ queryKey: ['payrun'] });
      qc.invalidateQueries({ queryKey: ['billing'] });
    },
  });
}

export function useCalendarOverlap(payPeriodNumber: number | undefined, enabled = true) {
  return useQuery({
    queryKey: periodConfigKeys.overlap(payPeriodNumber ?? 0),
    queryFn: () =>
      unwrap<CalendarOverlap>(
        api.GET('/v1/period-configs/overlap/{payPeriodNumber}', {
          params: { path: { payPeriodNumber: payPeriodNumber! } },
        }),
      ),
    enabled: enabled && payPeriodNumber !== undefined,
  });
}
