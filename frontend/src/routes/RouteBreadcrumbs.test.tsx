// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

/**
 * Route-driven breadcrumbs: the trail comes from routes/crumbs.ts metadata (handle.crumb via withCrumbs),
 * dynamic segments resolve from the page's query cache (same keys — no duplicate fetch), unpermitted
 * ancestors render as text, and the current page carries aria-current="page".
 */

// jsdom lacks matchMedia (the Breadcrumbs collapse logic reads it via useIsMobile).
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

const h = vi.hoisted(() => ({
  perms: new Set<string>(['users:view', 'clients:view', 'expenses:view']),
  clientImpl: (() =>
    Promise.resolve({
      data: { id: 'c1', name: 'Valley Fiber' },
      error: undefined,
      response: { ok: true, status: 200 },
    })) as () => Promise<{ data?: unknown; error?: unknown; response: { ok: boolean; status: number } }>,
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, permissions: h.perms, isSuperAdmin: false, roles: [], repId: null }),
}));

vi.mock('../api/client', () => ({
  api: {
    GET: (path: string) => {
      if (path === '/v1/clients/{id}') return h.clientImpl();
      if (path === '/v1/expense-items/{id}') {
        return Promise.resolve({ data: { id: 'e1', category: 'meals' }, error: undefined, response: { ok: true, status: 200 } });
      }
      return Promise.resolve({ data: {}, error: undefined, response: { ok: true, status: 200 } });
    },
  },
}));

import { RouteBreadcrumbs } from './RouteBreadcrumbs';
import { withCrumbs } from './crumbs';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  // The REAL registry + withCrumbs wiring, with the breadcrumb bar as each route's element (the shell
  // renders it globally in the app; here it IS the screen under test).
  const router = createMemoryRouter(
    withCrumbs([
      { path: 'admin', element: <div /> },
      { path: 'admin/users', element: <div /> },
      { path: 'admin/clients', element: <div /> },
      { path: 'admin/clients/:id', element: <div /> },
      { path: 'expenses', element: <div /> },
      { path: 'expenses/:id', element: <div /> },
      { path: 'expenses/:id/edit', element: <div /> },
    ]).map((r) => ({ ...r, element: <RouteBreadcrumbs /> })),
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  h.perms = new Set(['users:view', 'clients:view', 'expenses:view']);
  h.clientImpl = () =>
    Promise.resolve({ data: { id: 'c1', name: 'Valley Fiber' }, error: undefined, response: { ok: true, status: 200 } });
});

describe('RouteBreadcrumbs — route-driven trail', () => {
  it('renders the full nested trail with a linked ancestor and aria-current on the leaf', () => {
    renderAt('/admin/users');
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toBeTruthy();
    // ancestor is a LINK
    const admin = screen.getByRole('link', { name: 'Administration' });
    expect(admin.getAttribute('href')).toBe('/admin');
    // leaf is TEXT with aria-current="page"
    const leaf = screen.getByText('Users');
    expect(leaf.getAttribute('aria-current')).toBe('page');
    expect(leaf.tagName).not.toBe('A');
  });

  it('resolves a DYNAMIC segment from the entity data (client name as the leaf)', async () => {
    renderAt('/admin/clients/c1');
    expect(await screen.findByText('Valley Fiber')).toBeTruthy();
    expect(screen.getByText('Valley Fiber').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Clients & Products' })).toBeTruthy();
  });

  it('falls back to a truncated id when the dynamic fetch fails', async () => {
    h.clientImpl = () =>
      Promise.resolve({ data: undefined, error: { error: { message: 'not found' } }, response: { ok: false, status: 404 } });
    renderAt('/admin/clients/abcdef1234567890');
    expect(await screen.findByText('abcdef12…')).toBeTruthy();
  });

  it('renders an UNPERMITTED ancestor as text, not a link (§5 convenience)', () => {
    h.perms = new Set<string>(); // no users:view
    renderAt('/admin/users');
    // 'Users' is the leaf; with no users:view the leaf is text anyway — assert the PERMISSIONED ancestor case:
    // /admin/clients/:id with clients:view missing → 'Clients & Products' must NOT be a link.
    cleanup();
    renderAt('/admin/clients/c1');
    expect(screen.queryByRole('link', { name: 'Clients & Products' })).toBeNull();
    expect(screen.getByText('Clients & Products')).toBeTruthy(); // still in the trail, as text
  });

  it('walks CHAINED dynamic ancestors (Expenses › {item} › Edit)', async () => {
    renderAt('/expenses/e1/edit');
    expect(screen.getByRole('link', { name: 'Expenses' })).toBeTruthy();
    expect(await screen.findByText('Meals')).toBeTruthy(); // the dynamic ancestor resolves via the page's hook
    const leaf = screen.getByText('Edit');
    expect(leaf.getAttribute('aria-current')).toBe('page');
  });
});
