/**
 * PageHeader — design-system §6.6. Page title + primary action(s) + optional subtitle. Breadcrumbs are
 * NOT a per-page concern — the shell renders the route-driven trail globally (routes/RouteBreadcrumbs);
 * pages never hand-assemble crumbs. Tokens only.
 */
import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  );
}
