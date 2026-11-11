/**
 * Sales export log on the Sales page — client request 2026-11-11.
 *
 * - ExportStatusLine: "Last exported … by … · N sales · Excel", and the "Only sales not exported before (N)"
 *   choice the Export button uses. Counts come from the server for the CURRENT filters.
 * - ExportHistory: every recorded export, newest first (who, when, format, rows, all vs only-new, filters).
 * Both are `sales:export` (server-enforced); hidden without it. Tokens only.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge, Button, Card, Checkbox, Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { displayDateTime } from '../../../lib/format/date';
import { describeFilters } from '../saleExportLog';
import { useSaleExportHistory, useSaleExportSummary } from '../api/useSaleExports';
import type { SalesFilters } from '../sales.types';
import styles from './SalesExportPanel.module.css';

const FORMAT_LABEL: Record<string, string> = { csv: 'CSV', excel: 'Excel', pdf: 'PDF' };

export function ExportStatusLine({
  filters,
  onlyNew,
  onOnlyNewChange,
}: {
  filters: SalesFilters;
  onlyNew: boolean;
  onOnlyNewChange: (v: boolean) => void;
}) {
  const summary = useSaleExportSummary(filters);
  const s = summary.data;
  const last = s?.last_export;
  return (
    <div className={styles.statusLine}>
      <span className={styles.last}>
        {summary.isLoading
          ? 'Checking the last export…'
          : last
            ? `Last exported ${displayDateTime(last.generated_at)} by ${last.generated_by_name ?? 'a user'} · ${last.row_count ?? 0} sales · ${FORMAT_LABEL[last.format] ?? last.format}`
            : 'Not exported yet'}
      </span>
      <Checkbox
        checked={onlyNew}
        onCheckedChange={(v) => onOnlyNewChange(v === true)}
        label={`Only sales not exported before${s ? ` (${s.not_yet_exported} of ${s.matching})` : ''}`}
      />
    </div>
  );
}

export function ExportHistory() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const q = useSaleExportHistory(page, open);
  const rows = q.data?.data ?? [];
  const pageCount = q.data?.meta.pageCount ?? 1;
  return (
    <Card
      title={
        <button type="button" className={styles.toggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
          Export history
        </button>
      }
    >
      {open && (
        <DataState
          isLoading={q.isLoading}
          isError={q.isError}
          isEmpty={rows.length === 0}
          onRetry={() => q.refetch()}
          emptyNode={<p className={styles.muted}>No sales have been exported yet.</p>}
        >
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>By</TH>
                <TH>Format</TH>
                <TH align="right">Sales</TH>
                <TH>Which</TH>
                <TH>Filters</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className={styles.nowrap}>{displayDateTime(r.generated_at)}</TD>
                  <TD>{r.generated_by_name ?? ''}</TD>
                  <TD>{FORMAT_LABEL[r.format] ?? r.format}</TD>
                  <TD numeric>{r.row_count ?? ''}</TD>
                  <TD>{r.only_new ? <Badge tone="info">Only new</Badge> : <Badge tone="neutral">All matching</Badge>}</TD>
                  <TD>{describeFilters(r.filters)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {pageCount > 1 && (
            <div className={styles.pager}>
              <Button variant="tertiary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Newer
              </Button>
              <span className={styles.muted}>
                Page {page} of {pageCount}
              </span>
              <Button variant="tertiary" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Older
              </Button>
            </div>
          )}
        </DataState>
      )}
    </Card>
  );
}
