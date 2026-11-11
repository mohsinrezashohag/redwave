/**
 * ExportModal — generate an expense export (EXP-011): pick a format and optionally scope it to a client or
 * pay period. The backend records the export with a STUBBED file_url (generation deferred). `expenses:export`.
 * Tokens only.
 */
import { useState } from 'react';
import { Button, FormField, Modal, Select, useToast } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { useClients, usePayPeriods } from '../api/useLookups';
import { useCreateExport } from '../api/useExpenseMutations';
import type { ExportFormat } from '../expenses.types';

const NONE = '__none__';

export function ExportModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateExport();
  const canViewClients = useCan('clients:view');
  const canViewPeriods = useCan('payrun:view');
  const clients = useClients(open && canViewClients);
  const periods = usePayPeriods(open && canViewPeriods);

  const [format, setFormat] = useState<ExportFormat>('excel');
  const [clientId, setClientId] = useState<string | undefined>(undefined);
  const [periodId, setPeriodId] = useState<string | undefined>(undefined);

  const onGenerate = () =>
    create.mutate(
      { format, client_id: clientId, pay_period_id: periodId },
      {
        onSuccess: () => {
          toast({ title: 'Export recorded', description: 'File generation is stubbed for now.', tone: 'success' });
          onOpenChange(false);
        },
        onError,
      },
    );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Export expenses"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={onGenerate}>
            Generate export
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <FormField label="Format" required>
          <Select
            options={[
              { value: 'excel', label: 'Excel (.xlsx)' },
              { value: 'pdf', label: 'PDF' },
            ]}
            value={format}
            onValueChange={(v) => setFormat(v as ExportFormat)}
          />
        </FormField>
        {canViewClients && (
          <FormField label="Client" help="Optional. Limit to one client.">
            <Select
              options={[{ value: NONE, label: 'All clients' }, ...(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
              value={clientId ?? NONE}
              onValueChange={(v) => setClientId(v === NONE ? undefined : v)}
            />
          </FormField>
        )}
        {canViewPeriods && (
          <FormField label="Pay period" help="Optional. Limit to one period.">
            <Select
              options={[
                { value: NONE, label: 'All periods' },
                ...(periods.data ?? []).map((p) => ({ value: p.id, label: `Period ${p.period_number} · ${displayDate(p.start_date)}–${displayDate(p.end_date)}` })),
              ]}
              value={periodId ?? NONE}
              onValueChange={(v) => setPeriodId(v === NONE ? undefined : v)}
            />
          </FormField>
        )}
      </div>
    </Modal>
  );
}
