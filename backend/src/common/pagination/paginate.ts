/**
 * Pagination helpers — pure functions shared by every paginated list service. Translate {page,limit} →
 * {skip,take} (clamped), build the {data, meta} envelope (arch §5.1), and resolve a `field:dir` sort
 * against a per-entity ALLOWLIST (the allowlist is the orderBy-injection guard — an unknown field falls
 * back to the entity default rather than ordering by arbitrary input). No Nest/Prisma deps → unit-tested.
 */
export interface PageParams {
  page?: number;
  limit?: number;
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pageCount: number;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** {page,limit} → {skip,take} plus the clamped page/limit actually used (for the meta). */
export function toSkipTake({ page = 1, limit = DEFAULT_LIMIT }: PageParams): {
  skip: number;
  take: number;
  page: number;
  limit: number;
} {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const safePage = Math.max(Math.trunc(page) || 1, 1);
  return { skip: (safePage - 1) * safeLimit, take: safeLimit, page: safePage, limit: safeLimit };
}

/** Wrap a page of rows + the total count into the contract envelope. pageCount is 0 when empty. */
export function buildPage<T>(data: T[], total: number, page: number, limit: number): Page<T> {
  return { data, meta: { total, page, limit, pageCount: total === 0 ? 0 : Math.ceil(total / limit) } };
}

/**
 * Parse `field:dir` against `allowed` → a Prisma `orderBy` object; unknown/absent/malformed → `fallback`.
 * Only allowlisted fields can be ordered on, so a crafted `sort` can never order by an arbitrary column.
 */
export function resolveOrderBy<F extends string>(
  sort: string | undefined,
  allowed: readonly F[],
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, 'asc' | 'desc'> {
  if (!sort) return fallback;
  const [field, dir] = sort.split(':');
  if (!allowed.includes(field as F) || (dir !== 'asc' && dir !== 'desc')) return fallback;
  return { [field]: dir };
}
