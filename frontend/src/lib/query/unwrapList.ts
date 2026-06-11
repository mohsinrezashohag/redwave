/**
 * unwrapList — the SINGLE place the `{ data, meta }` pagination envelope is unwrapped for ARRAY consumers
 * (dropdowns, finders, lookups). The Batch-6 list contract returns `{ data, meta }` for paginated endpoints
 * (sales, clients, products, reps, expense-items, notifications, audit-logs) and a plain array for the rest;
 * this normalizes BOTH shapes to the row array. A consumer's `.map`/`.filter`/`.find` therefore never sees a
 * non-array — even if a today-plain endpoint gains pagination tomorrow. This closes the bug class behind the
 * production `(p.data ?? []).map is not a function` crash. Builds on `unwrap` (ok-checks + throws ApiError on
 * a non-2xx). For paginated TABLE state (page/sort/meta) use `useServerTable`, not this. — CLAUDE §13
 */
import { unwrap, type FetchResult } from './unwrap';

export async function unwrapList<T>(promise: Promise<FetchResult>): Promise<T[]> {
  const body = await unwrap<unknown>(promise);
  if (Array.isArray(body)) return body as T[]; // plain-array endpoints (e.g. /v1/users, /v1/pay-periods)
  if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: T[] }).data; // the { data, meta } pagination envelope
  }
  return []; // never a non-array → no consumer can `.map`-crash
}
