/**
 * ExportModal — generate the ADP export for a FINALIZED run (payrun:export). Pick a format; the server
 * produces the artifact and records it (the audit row is the stored record — no dedicated export table).
 * Re-export is allowed server-side. The button is disabled while in flight. payrun:export-gated in the UI;
 * the server is the real gate (§5).
 */
import { useState } from 'react';
import { Button, Modal, Select, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useExportRun } from '../api/usePayRunMutations';
import { triggerSave } from '../../../lib/api/downloadFile';
import { exportFilename } from '../../../lib/export/exportFilename';
import { todayIso } from '../../../lib/format/date';
import styles from './payrun.module.css';
import type { ExportFormat } from '../payrun.types';

export function ExportModal({
  runId,
  periodNumber,
  open,
  onClose,
}: {
  runId: string;
  periodNumber: number;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const exportRun = useExportRun();
  const [format, setFormat] = useState<ExportFormat>('csv');

  const onExport = () => {
    exportRun.mutate(
      { runId, body: { format } },
      {
        // The server returns the file's TEXT in `content`; saving it is the browser's job. (Before this, the
        // run was marked exported and toasted, but no file was ever written to disk.)
        onSuccess: (res) => {
          const isCsv = res.format === 'csv';
          const name = exportFilename({ source: `payrun-adp-period-${periodNumber}`, generatedOn: todayIso() });
          triggerSave(
            new Blob([res.content], { type: isCsv ? 'text/csv;charset=utf-8' : 'application/json' }),
            `${name}.${isCsv ? 'csv' : 'json'}`,
          );
          toast({
            title: 'Export downloaded',
            description: `${res.line_count} lines (${res.format.toUpperCase()}), saved to your Downloads folder`,
            tone: 'success',
          });
          onClose();
        },
        onError,
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !exportRun.isPending && onClose()}
      title="Export pay run (ADP)"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={exportRun.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="button" onClick={onExport} loading={exportRun.isPending} disabled={exportRun.isPending}>
            Generate export
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <Select
          options={[
            { value: 'csv', label: 'CSV (ADP)' },
            { value: 'json', label: 'JSON' },
          ]}
          value={format}
          onValueChange={(v) => setFormat(v as ExportFormat)}
          aria-label="Export format"
        />
        <p className={styles.note}>The export is recorded server-side (audit trail). Re-exporting is allowed.</p>
      </div>
    </Modal>
  );
}
