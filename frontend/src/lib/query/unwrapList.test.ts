import { describe, expect, it } from 'vitest';
import { unwrapList } from './unwrapList';
import type { FetchResult } from './unwrap';

const ok = (body: unknown): Promise<FetchResult> =>
  Promise.resolve({ data: body, error: undefined, response: { ok: true, status: 200 } as Response });
const fail = (status: number, errorBody?: unknown): Promise<FetchResult> =>
  Promise.resolve({ data: undefined, error: errorBody, response: { ok: false, status, statusText: 'err' } as Response });

const META = { total: 0, page: 1, limit: 20, pageCount: 0 };

describe('unwrapList — normalizes array-or-{data,meta} to a row array', () => {
  it('returns a plain-array body unchanged', async () => {
    expect(await unwrapList<number>(ok([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it('unwraps the { data, meta } pagination envelope to its data array', async () => {
    expect(await unwrapList<number>(ok({ data: [4, 5], meta: { ...META, total: 2, pageCount: 1 } }))).toEqual([4, 5]);
  });

  it('returns [] for an empty { data: [], meta } envelope', async () => {
    expect(await unwrapList(ok({ data: [], meta: META }))).toEqual([]);
  });

  it('returns [] when the body is an object without a data array (never a non-array)', async () => {
    expect(await unwrapList(ok({ foo: 'bar' }))).toEqual([]);
    expect(await unwrapList(ok({ data: 'not-an-array' }))).toEqual([]);
  });

  it('returns [] for null / undefined bodies', async () => {
    expect(await unwrapList(ok(null))).toEqual([]);
    expect(await unwrapList(ok(undefined))).toEqual([]);
  });

  it('throws (ApiError) on a non-2xx response, like unwrap', async () => {
    await expect(unwrapList(fail(500, { error: { message: 'boom' } }))).rejects.toThrow('boom');
  });
});
