/**
 * ExportMenu — a SplitButton that exports a list to CSV (default action) / Excel / PDF, or Prints it.
 * The caller passes `getRows` (sync or async) so the menu can export the FULL filtered set (a capped
 * fetch-all) or the current selection — not just the visible page. Gate it behind the caller's export/
 * view permission (the server is the real gate). Print uses the browser print dialog (→ Save as PDF) with
 * the app's print stylesheet. Excel/PDF libs load lazily on use. Tokens only.
 */
import { useState } from 'react';
import { FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { SplitButton } from '../ui/SplitButton';
import { useToast } from '../ui';
import { useApiErrorToast } from '../../lib/api/apiError';
import { exportRows, type ExportColumn, type ExportFormat } from '../../lib/export/exportRows';

export interface ExportMenuProps<Row> {
  filename: string;
  columns: ExportColumn<Row>[];
  /** Resolve the rows to export — the full filtered set or the current selection. */
  getRows: () => Promise<Row[]> | Row[];
  title?: string;
  label?: string;
}

export function ExportMenu<Row>({ filename, columns, getRows, title, label = 'Export' }: ExportMenuProps<Row>) {
  const { toast } = useToast();
  const onError = useApiErrorToast('Export failed. Please try again.');
  const [busy, setBusy] = useState(false);

  const run = async (format: ExportFormat) => {
    if (busy) return;
    setBusy(true);
    try {
      const rows = await getRows();
      if (!rows.length) {
        toast({ title: 'Nothing to export', description: 'No rows match the current filters.', tone: 'info' });
        return;
      }
      await exportRows({ format, filename, columns, rows, title });
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SplitButton
      label={busy ? 'Exporting…' : label}
      onClick={() => void run('csv')}
      items={[
        { label: 'Export CSV', icon: <FileText size={16} />, onSelect: () => void run('csv') },
        { label: 'Export Excel (.xlsx)', icon: <FileSpreadsheet size={16} />, onSelect: () => void run('xlsx') },
        { label: 'Export PDF', icon: <FileText size={16} />, onSelect: () => void run('pdf') },
        'separator',
        { label: 'Print', icon: <Printer size={16} />, onSelect: () => window.print() },
      ]}
    />
  );
}
