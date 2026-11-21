/**
 * ExportModal — the ADP export for a PAID report (payrun:export). Pick a format and, optionally, one rep:
 * the ADP file pays whole reps, so it filters by rep only (for one client, generate the report for that
 * client). The server produces the content and records it (the audit row is the record). Re-export is
 * allowed. The button is disabled while in flight; the server is the real gate (§5).
 */
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, FormField, Modal, Select, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useExportRun } from '../api/usePayRunMutations';
import { triggerSave } from '../../../lib/api/downloadFile';
import { exportFilename } from '../../../lib/export/exportFilename';
import { todayIso } from '../../../lib/format/date';
import { ALL, fromSentinel } from '../report.logic';
import styles from './payrun.module.css';
import type { ExportFormat } from '../payrun.types';

export interface RepChoice {
  id: string;
  code: string;
  label: string;
}

export function ExportModal({
  runId,
  fileSource,
  reps,
  open,
  onClose,
}: {
  runId: string;
  /** The file-name source, e.g. `payrun-adp-2026-11-01_2026-11-14`. */
  fileSource: string;
  /** The reps on this report (its lines). */
  reps: RepChoice[];
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const exportRun = useExportRun();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [repId, setRepId] = useState(ALL);
  useEffect(() => {
    if (open) setRepId(ALL);
  }, [open]);

  const onExport = () => {
    const rep = fromSentinel(repId);
    exportRun.mutate(
      { runId, body: { format, ...(rep ? { rep_id: rep } : {}) } },
      {
        // The server returns the file's TEXT in `content`; saving it is the browser's job.
        onSuccess: (res) => {
          const isCsv = res.format === 'csv';
          const repCode = rep ? `-${reps.find((r) => r.id === rep)?.code ?? 'rep'}` : '';
          const name = exportFilename({ source: `${fileSource}${repCode}`, generatedOn: todayIso() });
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
      title="Export for ADP"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={exportRun.isPending}>
            Cancel
          </Button>
          <Button leftIcon={<Download size={16} />} variant="primary" type="button" onClick={onExport} loading={exportRun.isPending} disabled={exportRun.isPending}>
            Generate export
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <FormField label="Format">
          <Select
            options={[
              { value: 'csv', label: 'CSV (ADP)' },
              { value: 'json', label: 'JSON' },
            ]}
            value={format}
            onValueChange={(v) => setFormat(v as ExportFormat)}
            aria-label="Export format"
          />
        </FormField>
        <FormField label="Rep" help="The ADP file pays whole reps, so it can be limited to one rep, not to one client.">
          <Select
            options={[{ value: ALL, label: 'All reps' }, ...reps.map((r) => ({ value: r.id, label: r.label }))]}
            value={repId}
            onValueChange={setRepId}
            aria-label="Rep"
          />
        </FormField>
        <p className={styles.note}>The export is recorded on the server (audit trail). Re-exporting is allowed.</p>
      </div>
    </Modal>
  );
}
