/**
 * After ANY successful change the cached screens re-read and the session refreshes (2026-11-12). One
 * change often touches several screens (a pay run moves sale statuses; an approval moves the users list,
 * rep pages and dashboard counts); per-feature refreshes missed most of them.
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { afterSuccessfulChange, isFileUrlQuery, setSessionRefresher } from './queryClient';

describe('after a successful change', () => {
  it('marks every cached query stale except short-lived file links, and refreshes the session', async () => {
    const client = new QueryClient();
    client.setQueryData(['sales', 'list'], [1]);
    client.setQueryData(['dashboards', 'rep'], { a: 1 });
    client.setQueryData(['documents', 'file-url', 'd1'], { url: 'x' });
    const refresh = vi.fn();
    setSessionRefresher(refresh);

    afterSuccessfulChange(client);

    expect(client.getQueryState(['sales', 'list'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['dashboards', 'rep'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['documents', 'file-url', 'd1'])?.isInvalidated).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    setSessionRefresher(null);
  });

  it('recognises signed-link queries', () => {
    expect(isFileUrlQuery({ queryKey: ['account', 'signatures', 'file-url', 'x'] })).toBe(true);
    expect(isFileUrlQuery({ queryKey: ['reps', 'headshot', 'r1'] })).toBe(true);
    expect(isFileUrlQuery({ queryKey: ['reps', 'one', 'r1'] })).toBe(false);
  });
});
