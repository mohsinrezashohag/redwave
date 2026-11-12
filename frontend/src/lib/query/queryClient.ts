/**
 * The shared TanStack Query client. One instance for the app; cleared on logout (AuthProvider) so a
 * new session never sees a previous user's cached data. — CLAUDE §13
 *
 * Freshness rules (2026-11-12):
 *   - AFTER ANY SUCCESSFUL CHANGE every cached query is marked stale: what is on screen re-reads at once,
 *     everything else re-reads when next opened. One change often touches several screens (an import
 *     commit writes reps, sales, rates…; finalizing a pay run changes sale statuses; approving a profile
 *     change moves the users list, rep pages and dashboard counts), and per-feature invalidation missed
 *     most of those. Per-mutation invalidations still run; this is the safety net.
 *   - The signed-in SESSION (/me: name, photo, roles, permissions) is refreshed after a change too, via the
 *     callback AuthProvider registers.
 *   - Stale queries refetch when the tab regains focus, so another user's changes show up. staleTime keeps
 *     that from firing on every click.
 * Signed-URL file queries are left alone so an open preview doesn't reload.
 */
import { MutationCache, QueryClient, type Query } from '@tanstack/react-query';

let refreshSession: (() => void) | null = null;

/** AuthProvider registers how to refresh /me; null on sign-out. */
export function setSessionRefresher(fn: (() => void) | null): void {
  refreshSession = fn;
}

/** Short-lived signed URLs (documents, signatures, headshots): re-minting one just reloads the image. */
export function isFileUrlQuery(query: Pick<Query, 'queryKey'>): boolean {
  return query.queryKey.some((k) => typeof k === 'string' && (k.endsWith('file-url') || k === 'headshot'));
}

/** What runs after every successful mutation. Exported for the test. */
export function afterSuccessfulChange(client: QueryClient): void {
  void client.invalidateQueries({ predicate: (q) => !isFileUrlQuery(q), refetchType: 'active' });
  refreshSession?.();
}

export const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () => afterSuccessfulChange(queryClient),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true, // only refetches queries already stale (older than staleTime)
    },
  },
});
