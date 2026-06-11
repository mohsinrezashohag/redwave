// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { type Page, useServerTable } from './useServerTable';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const page = <T,>(data: T[], over: Partial<Page<T>['meta']> = {}): Page<T> => ({
  data,
  meta: { total: data.length, page: 1, limit: 20, pageCount: data.length ? 1 : 0, ...over },
});

describe('useServerTable — the shared table state + envelope unwrap', () => {
  it('exposes rows + total + pageCount from a { data, meta } page', async () => {
    const { result } = renderHook(
      () =>
        useServerTable<{ id: string }, 'name'>({
          queryKey: (p) => ['t', p],
          fetchPage: () => Promise.resolve(page([{ id: 'a' }], { total: 5, pageCount: 3 })),
          defaultSort: { key: 'name', dir: 'asc' },
          filterKey: 'x',
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0].id).toBe('a');
    expect(result.current.total).toBe(5);
    expect(result.current.pageCount).toBe(3);
  });

  it('returns [] rows for an empty { data: [], meta } page (no crash, pageCount floored to 1)', async () => {
    const { result } = renderHook(
      () =>
        useServerTable<{ id: string }, 'name'>({
          queryKey: () => ['t'],
          fetchPage: () => Promise.resolve(page([])),
          defaultSort: { key: 'name', dir: 'asc' },
          filterKey: 'x',
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rows).toEqual([]);
    expect(result.current.pageCount).toBe(1);
  });

  it('toggleSort flips the same column and applies newColumnDir on a new column', async () => {
    const { result } = renderHook(
      () =>
        useServerTable<{ id: string }, 'name' | 'date'>({
          queryKey: () => ['t'],
          fetchPage: () => Promise.resolve(page([])),
          defaultSort: { key: 'name', dir: 'asc' },
          filterKey: 'x',
          newColumnDir: 'desc',
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.toggleSort('name')); // same column: asc → desc
    expect(result.current.sort).toEqual({ key: 'name', dir: 'desc' });
    act(() => result.current.toggleSort('date')); // new column: → newColumnDir ('desc')
    expect(result.current.sort).toEqual({ key: 'date', dir: 'desc' });
  });
});
