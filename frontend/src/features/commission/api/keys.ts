/** Query-key factories for the commission-config feature (mirrors the playbook). */
import type { IncentiveStatus } from '../commission.types';
import type { RateStatus } from '../../../components/ui';

/**
 * The effective-dated RATE keys carry the CLIENT SCOPE — without it the cache would serve one client's
 * schedule to another (`undefined` = every scope, `'global'` = the global fallback row). — CLAUDE #10
 */
export const commissionKeys = {
  all: ['commission'] as const,
  tiers: (clientId?: string) => ['commission', 'tiers', clientId ?? 'all'] as const,
  flatRates: (status: RateStatus | 'all', clientId?: string) =>
    ['commission', 'flat-rates', status, clientId ?? 'all'] as const,
  holdback: () => ['commission', 'holdback'] as const,
  release: () => ['commission', 'holdback-release'] as const,
  incentives: (status: IncentiveStatus | 'all') => ['commission', 'incentives', status] as const,
};
