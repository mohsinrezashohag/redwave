/**
 * Table — design-system §6.4 (the workhorse). Compositional primitives: Table + THead/TBody/TR/TH/TD,
 * plus Empty/Error/Skeleton states and a contextual BulkActionBar. Numeric/money columns are mono,
 * tabular, right-aligned; sticky header; zebra rows; dense/comfortable density; sortable headers.
 * Tokens only.
 */
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from './cx';
import { Skeleton } from './Skeleton';
import styles from './Table.module.css';

export type Density = 'comfortable' | 'dense';
export type SortDirection = 'asc' | 'desc' | null;
type Align = 'left' | 'right' | 'center';

export function Table({
  children,
  density = 'comfortable',
  className,
  maxHeight,
}: {
  children: ReactNode;
  density?: Density;
  className?: string;
  /**
   * When set, the scroll wrapper becomes a bounded, self-scrolling PANE (any CSS length, e.g. '72vh'): the
   * table scrolls WITHIN itself so its sticky header anchors here and works, and the app footer is never
   * pushed or overlapped on a tall/wide table. Omit (default) → the wrapper grows to content height (the
   * page is the scroller) — correct for tables embedded in modals/cards. — double-scroll fix
   */
  maxHeight?: string;
}) {
  return (
    <div className={cx(styles.scroll, maxHeight && styles.pane)} style={maxHeight ? { maxHeight } : undefined}>
      <table className={cx(styles.table, styles[density], className)}>{children}</table>
    </div>
  );
}

export const THead = ({ children }: { children: ReactNode }) => (
  <thead className={styles.thead}>{children}</thead>
);
export const TBody = ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>;

export function TR({
  children,
  selected,
  className,
}: {
  children: ReactNode;
  selected?: boolean;
  className?: string;
}) {
  return <tr className={cx(selected && styles.selected, className)}>{children}</tr>;
}

export interface THProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  sortable?: boolean;
  sortDirection?: SortDirection;
  onSort?: () => void;
}

export function TH({ children, align = 'left', sortable, sortDirection = null, onSort, className, ...rest }: THProps) {
  const ariaSort = sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : undefined;
  return (
    <th className={cx(styles.th, styles[`align-${align}`], className)} aria-sort={ariaSort} {...rest}>
      {sortable ? (
        <button type="button" className={styles.sortBtn} onClick={onSort}>
          {children}
          {sortDirection === 'asc' ? (
            <ArrowUp size={14} aria-hidden />
          ) : sortDirection === 'desc' ? (
            <ArrowDown size={14} aria-hidden />
          ) : (
            <ChevronsUpDown size={14} aria-hidden className={styles.sortMuted} />
          )}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TDProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  /** Numeric/money cell → mono tabular + right-aligned. */
  numeric?: boolean;
}

export function TD({ children, align, numeric, className, ...rest }: TDProps) {
  const resolvedAlign = align ?? (numeric ? 'right' : 'left');
  return (
    <td className={cx(styles.td, styles[`align-${resolvedAlign}`], numeric && 'mono', className)} {...rest}>
      {children}
    </td>
  );
}

/* ── States (§6.4 / §7) ──────────────────────────────────────────────────────── */
export function TableEmpty({ message, action }: { message: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyMsg}>{message}</p>
      {action}
    </div>
  );
}

export function TableError({ message, onRetry }: { message: ReactNode; onRetry?: () => void }) {
  return (
    <div className={styles.error}>
      <p className={styles.errorMsg}>{message}</p>
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className={styles.skeletonWrap} aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div
          className={styles.skeletonRow}
          key={r}
          style={{ ['--cols' as string]: String(columns) }}
        >
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} height="14px" width={c === 0 ? '40%' : '70%'} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Contextual action bar shown when table rows are selected (§6.4). */
export function BulkActionBar({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div className={styles.bulkBar} role="region" aria-label="Bulk actions">
      <span className={styles.bulkCount}>
        <strong className="mono">{count}</strong> selected
      </span>
      <div className={styles.bulkActions}>{children}</div>
    </div>
  );
}
