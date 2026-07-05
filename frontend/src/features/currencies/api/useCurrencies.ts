/**
 * Currency catalogue hook — the allowed billing/expense currencies (authenticated reference read, no
 * permission). Drives the client billing-currency picker + the per-item expense currency picker. Cached a
 * while (changes rarely). Mirrors useProductTypes. — Meeting 3
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrapList } from '../../../lib/query/unwrapList';
import type { Currency } from '../currencies.types';

export const currencyKeys = {
  all: ['currencies'] as const,
  list: () => ['currencies', 'list'] as const,
};

export function useCurrencies(enabled = true) {
  return useQuery({
    queryKey: currencyKeys.list(),
    queryFn: () => unwrapList<Currency>(api.GET('/v1/currencies')),
    enabled,
    staleTime: 5 * 60_000,
  });
}
