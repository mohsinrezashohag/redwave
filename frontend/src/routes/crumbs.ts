/**
 * crumbs — THE single declaration site for every route's breadcrumb (one entry per router path).
 * The router is FLAT (all feature routes are siblings under '/' + AppShell), so the logical hierarchy
 * comes from explicit `parent` pointers here, not URL nesting. `withCrumbs` injects each entry into the
 * route's `handle` so RouteBreadcrumbs can read the leaf via useMatches() and walk parents through this
 * map. NEW ROUTES MUST ADD AN ENTRY — `withCrumbs` warns in dev when one is missing (CLAUDE §13).
 * Ad-hoc per-page breadcrumbs are forbidden; the shell renders the trail globally.
 */
import type { RouteObject } from 'react-router-dom';

/** Detail routes resolve a human label from the page's OWN query cache (see crumbLabels.tsx). */
export type DynamicKind =
  | 'sale'
  | 'client'
  | 'payrun'
  | 'document'
  | 'expenseItem'
  | 'statement'
  | 'expenseDoc'
  | 'role'
  | 'importBatch';

export interface CrumbMeta {
  /** Static label (omit when `dynamic` is set). */
  label?: string;
  /** Resolve the label from already-loaded entity data (the `:id` param). */
  dynamic?: DynamicKind;
  /** The LOGICAL parent route path (an entry in this map) — drives the trail, not URL nesting. */
  parent?: string;
  /** When the caller lacks this permission, the segment renders as text, not a link (§5 convenience). */
  permission?: string;
}

/** Keyed by the router path as declared in router.tsx (leading slash; ':param' patterns as-is). */
export const CRUMBS: Record<string, CrumbMeta> = {
  '/': { label: 'Dashboard' },

  // ── Dashboards (top-level single crumbs) ───────────────────────────────────────────
  '/dashboards/rep': { label: 'My dashboard' },
  '/dashboards/manager': { label: 'Team dashboard' },
  '/dashboards/business': { label: 'Business overview' },
  '/dashboards/admin': { label: 'Operations' },
  '/dashboards/leaderboard': { label: 'Leaderboard' },
  '/chatbot': { label: 'Assistant' },

  // ── Sales (the Validation queue is the /sales?status= preset — same route) ─────────
  '/sales': { label: 'Sales' },
  '/sales/new': { label: 'Enter sale', parent: '/sales' },
  '/sales/:id': { dynamic: 'sale', parent: '/sales' },

  // ── Expenses ───────────────────────────────────────────────────────────────────────
  '/expenses': { label: 'Expenses' },
  '/expenses/new': { label: 'Add expense', parent: '/expenses' },
  '/expenses/approvals': { label: 'Approvals', parent: '/expenses' },
  '/expenses/:id': { dynamic: 'expenseItem', parent: '/expenses' },
  '/expenses/:id/edit': { label: 'Edit', parent: '/expenses/:id' },

  // ── Money ──────────────────────────────────────────────────────────────────────────
  '/pay-runs': { label: 'Pay runs' },
  '/pay-runs/:id': { dynamic: 'payrun', parent: '/pay-runs' },
  '/clawbacks': { label: 'Clawbacks' },
  '/clawbacks/new': { label: 'New clawback', parent: '/clawbacks' },
  '/billing': { label: 'Billing' },
  '/billing/statements/:id': { dynamic: 'statement', parent: '/billing' },
  '/billing/expense-documents': { label: 'Expense documents', parent: '/billing', permission: 'billing:view' },
  '/billing/expense-documents/:id': { dynamic: 'expenseDoc', parent: '/billing/expense-documents' },

  // ── People / documents ─────────────────────────────────────────────────────────────
  '/documents': { label: 'Documents' },
  '/documents/:id': { dynamic: 'document', parent: '/documents' },

  // ── Administration (all children point at the hub; the hub self-gates, so no permission) ──
  '/admin': { label: 'Administration' },
  '/admin/profile-review': { label: 'Profile reviews', parent: '/admin', permission: 'profile:approve' },
  '/admin/users': { label: 'Users', parent: '/admin', permission: 'users:view' },
  '/admin/roles': { label: 'Roles', parent: '/admin', permission: 'roles:view' },
  '/admin/roles/new': { label: 'New role', parent: '/admin/roles' },
  '/admin/roles/:id': { dynamic: 'role', parent: '/admin/roles' },
  '/admin/notifications': { label: 'Notification settings', parent: '/admin', permission: 'settings:view' },
  '/admin/broadcast': { label: 'Broadcast', parent: '/admin', permission: 'notifications:broadcast' },
  '/admin/reps': { label: 'Reps', parent: '/admin', permission: 'hrm:view' },
  '/admin/clients': { label: 'Clients & Products', parent: '/admin', permission: 'clients:view' },
  '/admin/clients/:id': { dynamic: 'client', parent: '/admin/clients' },
  '/admin/products': { label: 'Products', parent: '/admin', permission: 'clients:view' },
  '/admin/commission': { label: 'Commission Config', parent: '/admin', permission: 'commission:view' },
  '/admin/product-types': { label: 'Product types', parent: '/admin', permission: 'commission:view' },
  '/admin/km-rates': { label: 'KM rates', parent: '/admin', permission: 'expenses:view' },
  '/admin/security': { label: 'Security', parent: '/admin', permission: 'settings:view' },
  '/admin/audit': { label: 'Audit log', parent: '/admin', permission: 'audit:view' },
  '/admin/reconciliation': { label: 'Reconciliation', parent: '/admin', permission: 'billing:view' },

  // ── Import ─────────────────────────────────────────────────────────────────────────
  '/import': { label: 'Import' },
  '/import/new': { label: 'New import', parent: '/import' },
  '/import/:id': { dynamic: 'importBatch', parent: '/import' },

  // ── Reports / misc ─────────────────────────────────────────────────────────────────
  '/reports': { label: 'Reports' },
  '/reports/trends': { label: 'Cross-period trends', parent: '/reports', permission: 'reports:business' },
  '/reports/exports': { label: 'Report exports', parent: '/reports' },
  '/notifications': { label: 'Notifications' },
  '/account': { label: 'My Account' },
  '/showcase': { label: 'Showcase' },
};

/** The shape RouteBreadcrumbs reads off a matched route. */
export interface CrumbHandle {
  crumb: CrumbMeta & { path: string };
}

/**
 * Inject `handle: { crumb }` into AppShell's child routes from the CRUMBS map (single source of truth).
 * Redirect-only and catch-all routes are exempt; any OTHER route without an entry gets a dev warning —
 * the enforcement behind "new routes MUST declare crumb metadata" (CLAUDE §13).
 */
export function withCrumbs(routes: RouteObject[], parentPath = ''): RouteObject[] {
  return routes.map((route) => {
    const full = route.index ? parentPath || '/' : joinPath(parentPath, route.path);
    const meta = CRUMBS[full];
    const isExempt = route.path === '*' || !route.element || isRedirect(route);
    if (!meta && !isExempt && (route.path || route.index)) {
      if (import.meta.env.DEV) {
        console.warn(`[crumbs] route "${full}" has no breadcrumb entry — add it to routes/crumbs.ts`);
      }
    }
    const handle: CrumbHandle | undefined = meta ? { crumb: { ...meta, path: full } } : undefined;
    // Spreading collapses RouteObject's index/non-index discriminated union — safe, shape unchanged.
    return {
      ...route,
      ...(handle ? { handle } : {}),
      ...(route.children ? { children: withCrumbs(route.children, route.path ? full : parentPath) } : {}),
    } as RouteObject;
  });
}

function joinPath(parent: string, path?: string): string {
  if (!path) return parent || '/';
  if (path.startsWith('/')) return path;
  return `${parent === '/' ? '' : parent}/${path}`;
}

/** A <Navigate> redirect route (no crumb needed — it never renders content). */
function isRedirect(route: RouteObject): boolean {
  const el = route.element as { type?: { name?: string } } | null | undefined;
  return !!el && typeof el === 'object' && el.type?.name === 'Navigate';
}
