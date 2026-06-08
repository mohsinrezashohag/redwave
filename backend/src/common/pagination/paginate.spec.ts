import { buildPage, resolveOrderBy, toSkipTake } from './paginate';

describe('pagination helpers', () => {
  describe('toSkipTake', () => {
    it('defaults to page 1, limit 20', () => {
      expect(toSkipTake({})).toEqual({ skip: 0, take: 20, page: 1, limit: 20 });
    });

    it('computes skip from a 1-based page', () => {
      expect(toSkipTake({ page: 3, limit: 15 })).toEqual({ skip: 30, take: 15, page: 3, limit: 15 });
    });

    it('clamps limit to 1..100 and page to >=1', () => {
      expect(toSkipTake({ page: 0, limit: 500 })).toEqual({ skip: 0, take: 100, page: 1, limit: 100 });
      expect(toSkipTake({ page: -2, limit: 0 })).toEqual({ skip: 0, take: 20, page: 1, limit: 20 });
    });
  });

  describe('buildPage', () => {
    it('wraps rows + total into the envelope and derives pageCount', () => {
      expect(buildPage([{ id: 'a' }], 41, 2, 20)).toEqual({
        data: [{ id: 'a' }],
        meta: { total: 41, page: 2, limit: 20, pageCount: 3 },
      });
    });

    it('reports pageCount 0 for an empty result', () => {
      expect(buildPage([], 0, 1, 20).meta.pageCount).toBe(0);
    });
  });

  describe('resolveOrderBy', () => {
    const allowed = ['sale_date', 'status', 'created_at'] as const;
    const fallback = { sale_date: 'desc' as const };

    it('returns the fallback when sort is absent', () => {
      expect(resolveOrderBy(undefined, allowed, fallback)).toEqual({ sale_date: 'desc' });
    });

    it('honours an allowlisted field + direction', () => {
      expect(resolveOrderBy('status:asc', allowed, fallback)).toEqual({ status: 'asc' });
    });

    it('falls back (no injection) for a non-allowlisted field or bad direction', () => {
      expect(resolveOrderBy('rep_id:asc', allowed, fallback)).toEqual({ sale_date: 'desc' });
      expect(resolveOrderBy('status:sideways', allowed, fallback)).toEqual({ sale_date: 'desc' });
    });
  });
});
