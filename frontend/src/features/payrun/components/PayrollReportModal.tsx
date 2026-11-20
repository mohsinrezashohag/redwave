/**
 * PayrollReportModal — download Redwave's payroll workbook (.xlsx) for a PAID report, optionally narrowed to
 * one client and/or one rep. The workbook is streamed from the lines FROZEN at "Mark as paid" (#2) and
 * rendered server-side; the UI only passes the filter. payrun:export-gated; the server is the real gate (§5).
 */
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, FormField, Modal, Select, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { downloadFile } from '../../../lib/api/downloadFile';
import { useReportClients } from '../api/usePayRun';
import { ALL, fromSentinel, payrollDownloadPath } from '../report.logic';
import type { RepChoice } from './ExportModal';
import styles from './payrun.module.css';

export function PayrollReportModal({
  runId,
  reps,
  fixedClient,
  open,
  onClose,
}: {
  runId: string;
  reps: RepChoice[];
  /** Set when the report itself is limited to one client: the workbook then needs no client filter. */
  fixedClient: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const clients = useReportClients(open && !fixedClient);
  const [clientId, setClientId] = useState(ALL);
  const [repId, setRepId] = useState(ALL);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setClientId(ALL);
      setRepId(ALL);
    }
  }, [open]);

  const onDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadFile(payrollDownloadPath(runId, fromSentinel(clientId), fromSentinel(repId)));
      toast({ title: 'Payroll report downloaded', tone: 'success' });
      onClose();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title="Payroll report (Excel)"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button leftIcon={<Download size={16} />} variant="primary" type="button" onClick={onDownload} loading={busy} disabled={busy}>
            Download
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        {fixedClient ? (
          <p className={styles.note}>This report covers {fixedClient} only.</p>
        ) : (
          <FormField label="Client">
            <Select
              options={[
                { value: ALL, label: 'All clients' },
                ...(clients.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })),
              ]}
              value={clientId}
              onValueChange={setClientId}
              aria-label="Client"
            />
          </FormField>
        )}
        <FormField label="Rep">
          <Select
            options={[{ value: ALL, label: 'All reps' }, ...reps.map((r) => ({ value: r.id, label: r.label }))]}
            value={repId}
            onValueChange={setRepId}
            aria-label="Rep"
          />
        </FormField>
        <p className={styles.note}>One row per sale, read from the amounts frozen when the report was marked as paid.</p>
      </div>
    </Modal>
  );
}
