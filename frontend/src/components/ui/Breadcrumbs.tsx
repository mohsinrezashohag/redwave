/**
 * Breadcrumbs — design-system §6.6. The PRESENTATION of a breadcrumb trail: semantic
 * <nav aria-label="Breadcrumb"> + ordered list, router <Link> ancestors (SPA navigation — never a raw
 * <a> full reload), plain-text current page with aria-current="page", per-segment ellipsis truncation
 * (title attr carries the full label), and a narrow-width collapse (first … last). Labels may be
 * ReactNodes (the route-driven system renders skeleton segments while a dynamic label loads).
 * Trails are BUILT centrally by routes/RouteBreadcrumbs — pages never hand-assemble crumbs. Tokens only.
 */
import { ChevronRight } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useIsMobile } from '../../lib/useMediaQuery';
import styles from './Breadcrumbs.module.css';

export interface Crumb {
  label: ReactNode;
  /** The full label for the title attribute when `label` is a plain string (truncation tooltip). */
  title?: string;
  /** Router path — ancestors with a `to` render as Links; without one (RBAC-stripped) as text. */
  to?: string;
}

const ELLIPSIS: Crumb = { label: '…', title: 'Collapsed breadcrumb segments' };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const isMobile = useIsMobile();
  // Narrow widths collapse the MIDDLE segments — the first and current pages stay visible. — §6.6
  const visible = isMobile && items.length > 3 ? [items[0], ELLIPSIS, items[items.length - 1]] : items;

  return (
    <nav className={styles.nav} aria-label="Breadcrumb">
      <ol className={styles.list} role="list">
        {visible.map((c, i) => {
          const last = i === visible.length - 1;
          const title = c.title ?? (typeof c.label === 'string' ? c.label : undefined);
          return (
            <Fragment key={i}>
              <li className={styles.item}>
                {c.to && !last ? (
                  <Link to={c.to} className={styles.link} title={title}>
                    {c.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className={last ? styles.current : styles.text}
                    title={title}
                  >
                    {c.label}
                  </span>
                )}
              </li>
              {!last && <ChevronRight size={14} className={styles.sep} aria-hidden />}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
