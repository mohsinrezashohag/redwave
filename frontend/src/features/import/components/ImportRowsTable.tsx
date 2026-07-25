/**
 * ImportRowsTable — the staged rows with their server-assigned match status, the mapped data, the matched
 * target, and the per-row issue. While the batch is staged, a kebab offers the reconcile actions (Match a
 * sale / Edit data / Ignore) — the UI never matches; it asks the backend to reconcile. Tokens only.
 */
import { EyeOff, Link2, MoreHorizontal, Pencil } from 'lucide-react';
import { DropdownMenu, IconButton, Table, TBody, TD, TH, THead, TR, type MenuEntry } from '../../../components/ui';
import { RowStatusBadge } from './RowStatusBadge';
import styles from './import.module.css';
import type { ImportBatch, ImportRow, KindDef } from '../import.types';

interface Props {
  batch: ImportBatch;
  kind?: KindDef;
  canEdit: boolean;
  onMatch: (row: ImportRow) => void;
  onEdit: (row: ImportRow) => void;
  onIgnore: (row: ImportRow) => void;
}

export function ImportRowsTable({ batch, kind, canEdit, onMatch, onEdit, onIgnore }: Props) {
  const staged = batch.status === 'staged';
  const rows = batch.import_rows ?? [];

  const menu = (row: ImportRow): MenuEntry[] => {
    const items: MenuEntry[] = [];
    if (kind?.kind === 'bulk_validation') items.push({ label: 'Match a sale', icon: <Link2 size={15} />, onSelect: () => onMatch(row) });
    items.push({ label: 'Edit data', icon: <Pencil size={15} />, onSelect: () => onEdit(row) });
    if (row.match_status !== 'ignored') items.push('separator', { label: 'Ignore (skip)', icon: <EyeOff size={15} />, onSelect: () => onIgnore(row) });
    return items;
  };

  return (
    <Table density="dense">
      <THead>
        <TR>
          <TH align="right">#</TH>
          <TH>Status</TH>
          <TH>Data</TH>
          <TH>Matched</TH>
          <TH>Issue</TH>
          {staged && canEdit && <TH align="right" aria-label="Actions" />}
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.id}>
            <TD numeric>{row.row_number}</TD>
            <TD>
              <RowStatusBadge status={row.match_status} />
            </TD>
            <TD>
              <span className={styles.jsonCell} title={JSON.stringify(row.mapped_data ?? row.raw_data)}>
                {JSON.stringify(row.mapped_data ?? row.raw_data)}
              </span>
            </TD>
            <TD>
              <span className="mono">{row.matched_entity_id ? row.matched_entity_id.slice(0, 8) : '—'}</span>
            </TD>
            <TD>
              {/* A MATCHED row's note is informational ("will create client VF"), not a failure — styling it
                  like an error would make a healthy row read as broken. */}
              <span className={row.match_status === 'matched' ? styles.noteCell : styles.issueCell}>{row.issue ?? '—'}</span>
            </TD>
            {staged && canEdit && (
              <TD align="right">
                <DropdownMenu trigger={<IconButton label={`Reconcile row ${row.row_number}`} icon={<MoreHorizontal size={16} />} size="sm" />} items={menu(row)} />
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
