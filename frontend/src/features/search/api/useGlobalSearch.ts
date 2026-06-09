/**
 * useGlobalSearch — the top-bar search query. RBAC-scoping is enforced SERVER-SIDE (the endpoint only
 * returns entity groups the caller may see), so this is a thin read. Enabled once the term is ≥2 chars.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import type { components } from '../../../api/generated/schema';

export type SearchResults = components['schemas']['SearchResponse'];

export function useGlobalSearch(q: string) {
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => unwrap<SearchResults>(api.GET('/v1/search', { params: { query: { q } } })),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
}
