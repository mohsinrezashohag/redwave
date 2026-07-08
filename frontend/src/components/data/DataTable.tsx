/**
 * DataTable — the enterprise list surface (design-system §6.4). A thin orchestrator over the foundation
 * Table primitives + DataState + BulkActionBar that adds: server-driven sort (header click → onSortChange),
 * server pagination (a pager over page/pageCount/total), controlled row selection with a tri-state
 * "select all", per-row actions + a bulk-action bar, and a dedicated FORBIDDEN state (a restricted role
 * sees a friendly panel, NOT "Failed to load"). All money/values are rendered by the caller's column
 * `render` (no math here). Tokens only.
 */
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  BulkActionBar,
  Banner,
  Checkbox,
  IconButton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableSkeleton,
} from '../ui';
import { DataState } from './DataState';
import { isForbidden } from '../../lib/api/apiError';
import styles from './DataTable.module.css';

export interface DataColumn<Row, SortKey extends string = string> {
  id: string;
  header: ReactNode;
  align?: 'left' | 'right' | 'center';
  numeric?: boolean;
  /** Present → the column is sortable; matched against the server `sort`. */
  sortKey?: SortKey;
  render: (row: Row) => ReactNode;
}

export interface ServerSort<SortKey extends string = string> {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export interface DataTableProps<Row, SortKey extends string = string> {
  columns: DataColumn<Row, SortKey>[];
  rows: Row[];
  getRowId: (row: Row) => string;

  // server-driven sort
  sort?: ServerSort<SortKey>;
  onSortChange?: (key: SortKey) => void;

  // server pagination (1-based)
  page: number;
  pageCount: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;

  // controlled selection
  selectedIds?: Set<string>;
  onSelect?: (id: string, next: boolean) => void;
  isRowSelectable?: (row: Row) => boolean;
  onToggleAll?: () => void;
  allSelectableSelected?: boolean;

  // slots
  rowActions?: (row: Row) => ReactNode;
  bulkActions?: ReactNode;

  // states
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyNode?: ReactNode;
  forbiddenMessage?: string;

  density?: 'comfortable' | 'dense';
  /**
   * OPT-IN: cap the table into a self-scrolling pane (e.g. '72vh'). Default is '' (OFF) so the list renders
   * at natural height and the PAGE (<main>) is the single scroller with the footer pinned — no nested scroll
   * pane. Only pass a value for a genuinely huge table that benefits from a frozen header. — single-scroller
   */
  stickyMaxHeight?: string;
  'aria-label'?: string;
}

export function DataTable<Row, SortKey extends string = string>({
  columns,
  rows,
  getRowId,
  sort,
  onSortChange,
  page,
  pageCount,
  total,
  limit,
  onPageChange,
  selectedIds,
  onSelect,
  isRowSelectable,
  onToggleAll,
  allSelectableSelected,
  rowActions,
  bulkActions,
  isLoading,
  isError,
  error,
  onRetry,
  emptyNode,
  forbiddenMessage = 'You don’t have permission to view this list. The server enforces access regardless of navigation.',
  density = 'comfortable',
  stickyMaxHeight = '',
  'aria-label': ariaLabel,
}: DataTableProps<Row, SortKey>) {
  // A 403 is not a failure to surface as "Failed to load" — show a friendly forbidden panel (§5).
  if (isError && isForbidden(error)) {
    return (
      <Banner tone="warning" title="Access denied">
        {forbiddenMessage}
      </Banner>
    );
  }

  const selectable = !!onSelect;
  const selectedCount = selectedIds?.size ?? 0;
  const headerChecked: boolean | 'indeterminate' = allSelectableSelected ? true : selectedCount > 0 ? 'indeterminate' : false;
  const colCount = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);

  return (
    <div className={styles.wrap} role="region" aria-label={ariaLabel}>
      {!!bulkActions && selectedCount > 0 && (
        <div className="no-print">
          <BulkActionBar count={selectedCount}>{bulkActions}</BulkActionBar>
        </div>
      )}

      <DataState
        isLoading={isLoading}
        isError={isError}
        isEmpty={rows.length === 0}
        onRetry={onRetry}
        errorMessage={error instanceof Error ? error.message : undefined}
        loadingNode={<TableSkeleton rows={Math.min(limit, 8)} columns={colCount} />}
        emptyNode={emptyNode}
      >
        <Table density={density} maxHeight={stickyMaxHeight || undefined}>
          <THead>
            <TR>
              {selectable && (
                <TH className={styles.selectCell}>
                  {onToggleAll && (
                    <Checkbox checked={headerChecked} onCheckedChange={() => onToggleAll()} aria-label="Select all rows" />
                  )}
                </TH>
              )}
              {columns.map((col) => (
                <TH
                  key={col.id}
                  align={col.align ?? (col.numeric ? 'right' : 'left')}
                  sortable={!!col.sortKey}
                  sortDirection={col.sortKey && sort?.key === col.sortKey ? sort.dir : null}
                  onSort={col.sortKey && onSortChange ? () => onSortChange(col.sortKey as SortKey) : undefined}
                >
                  {col.header}
                </TH>
              ))}
              {rowActions && <TH align="right">Actions</TH>}
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => {
              const id = getRowId(row);
              const rowSelectable = !isRowSelectable || isRowSelectable(row);
              const checked = selectedIds?.has(id) ?? false;
              return (
                <TR key={id} selected={checked}>
                  {selectable && (
                    <TD className={styles.selectCell}>
                      {rowSelectable && (
                        <Checkbox checked={checked} onCheckedChange={(v) => onSelect?.(id, v === true)} aria-label="Select row" />
                      )}
                    </TD>
                  )}
                  {columns.map((col) => (
                    <TD key={col.id} align={col.align ?? (col.numeric ? 'right' : 'left')} numeric={col.numeric}>
                      {col.render(row)}
                    </TD>
                  ))}
                  {rowActions && (
                    <TD align="right" className={styles.actionsCell}>
                      {rowActions(row)}
                    </TD>
                  )}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </DataState>

      {!isLoading && !isError && rows.length > 0 && pageCount > 1 && (
        <div className={`${styles.pager} no-print`}>
          <span className={styles.pageInfo}>
            <strong className="mono">{total}</strong> rows · page <strong className="mono">{page}</strong> of{' '}
            <strong className="mono">{pageCount}</strong>
          </span>
          <div className={styles.pageBtns}>
            <IconButton
              label="Previous page"
              icon={<ChevronLeft size={16} />}
              variant="outline"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            />
            <IconButton
              label="Next page"
              icon={<ChevronRight size={16} />}
              variant="outline"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
