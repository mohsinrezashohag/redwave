/**
 * Sales-targets hooks — count goals per rep per pay period (RPT-008). The list is server-scoped (rep=own,
 * manager=roster, admin=all); the upsert requires hrm:edit (the server is the real gate). Setting a target
 * invalidates the dashboards so target-vs-actual refreshes.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { dashboardKeys, targetKeys } from './keys';
import type { SalesTarget } from '../dashboards.types';

export function useSalesTargets(payPeriodId?: string, enabled = true) {
  return useQuery({
    queryKey: targetKeys.list(payPeriodId),
    queryFn: () => unwrap<SalesTarget[]>(api.GET('/v1/sales-targets', { params: { query: { pay_period_id: payPeriodId } } })),
    enabled,
  });
}

export interface SetTargetBody {
  rep_id: string;
  pay_period_id: string;
  target_count: number;
}

export function useSetTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetTargetBody) => unwrap<SalesTarget>(api.PUT('/v1/sales-targets', { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: targetKeys.all });
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}
