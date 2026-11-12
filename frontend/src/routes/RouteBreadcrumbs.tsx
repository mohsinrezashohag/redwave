/**
 * RouteBreadcrumbs — THE app-wide breadcrumb bar, rendered once in the AppShell (below the top bar,
 * above every page's title area). Route-driven: reads the matched leaf's `handle.crumb` (injected by
 * `withCrumbs` from routes/crumbs.ts) and walks its `parent` pointers to build the trail — pages never
 * hand-assemble crumbs. Dynamic segments resolve entity names from the page's own query cache
 * (crumbLabels.tsx; skeleton while loading, truncated id on failure). RBAC-aware: an ancestor whose
 * `permission` the caller lacks renders as text, not a link (§5 — convenience only; the server is the
 * real gate). Routes without metadata (the NotFound catch-all) render nothing.
 */
import { useCallback, useEffect, useState } from 'react';
import { useMatches, useParams } from 'react-router-dom';
import { Breadcrumbs, type Crumb } from '../components/ui';
import { useAuth } from '../auth/useAuth';
import { CRUMBS, type CrumbHandle, type CrumbMeta } from './crumbs';
import { DYNAMIC_CRUMBS } from './crumbLabels';
import { CrumbTitleContext, pageTitle, APP_TITLE } from './crumbTitle';

const MAX_DEPTH = 6; // defensive bound on parent walking (a registry cycle is a config bug)

/** Substitute route params into a path pattern ('/expenses/:id' → '/expenses/abc'). */
function concretePath(pattern: string, params: Record<string, string | undefined>): string {
  return pattern.replace(/:(\w+)/g, (_, key: string) => params[key] ?? '');
}

function labelFor(meta: CrumbMeta, params: Record<string, string | undefined>): Crumb['label'] {
  if (meta.dynamic) {
    const id = params.id;
    if (!id) return meta.label ?? '…';
    const Dynamic = DYNAMIC_CRUMBS[meta.dynamic];
    return <Dynamic id={id} />;
  }
  return meta.label ?? '';
}

export function RouteBreadcrumbs() {
  const matches = useMatches();
  const params = useParams();
  const { permissions } = useAuth();
  // The resolved record name, tagged with the page it belongs to so a new page never shows the old one.
  const [record, setRecord] = useState<{ key: string; name: string | null }>({ key: '', name: null });

  // The deepest matched route that declared a crumb (flat router → effectively the leaf).
  const leaf = [...matches].reverse().find((m) => (m.handle as CrumbHandle | undefined)?.crumb);
  const leafCrumb = (leaf?.handle as CrumbHandle | undefined)?.crumb;
  const pageKey = `${leafCrumb?.path ?? ''}|${params.id ?? ''}`;
  const recordName = record.key === pageKey ? record.name : null;
  const reportName = useCallback((name: string | null) => setRecord({ key: pageKey, name }), [pageKey]);

  // The trail's plain labels (root → leaf), for the browser tab title.
  const titleTrail: (string | null | undefined)[] = [];
  for (let meta: CrumbMeta | undefined = leafCrumb, depth = 0; meta && depth < MAX_DEPTH; depth += 1) {
    titleTrail.unshift(meta === leafCrumb && meta.dynamic ? recordName : meta.label);
    meta = meta.parent ? CRUMBS[meta.parent] : undefined;
  }
  const title = leafCrumb ? pageTitle(titleTrail) : APP_TITLE;
  useEffect(() => {
    document.title = title;
  }, [title]);

  if (!leafCrumb) {
    return null;
  }

  // Walk parent pointers (leaf → root), then reverse into display order.
  const chain: { meta: CrumbMeta; path: string }[] = [{ meta: leafCrumb, path: leafCrumb.path }];
  let parent = leafCrumb.parent;
  for (let depth = 0; parent && depth < MAX_DEPTH; depth += 1) {
    const meta = CRUMBS[parent];
    if (!meta) break;
    chain.push({ meta, path: parent });
    parent = meta.parent;
  }
  chain.reverse();

  const items: Crumb[] = chain.map(({ meta, path }, i) => {
    const last = i === chain.length - 1;
    // RBAC: an unpermitted ancestor is plain text — never a link the user can't follow. — §5
    const linkable = !last && (!meta.permission || permissions.has(meta.permission));
    return {
      label: labelFor(meta, params),
      title: meta.label,
      ...(linkable ? { to: concretePath(path, params) } : {}),
    };
  });

  return (
    <CrumbTitleContext.Provider value={reportName}>
      <Breadcrumbs items={items} />
    </CrumbTitleContext.Provider>
  );
}
