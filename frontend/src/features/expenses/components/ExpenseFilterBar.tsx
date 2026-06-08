/**
 * ExpenseFilterBar — server-side filters for the reports list (status / rep / client / date range). Filter
 * state lives in the URL (the page owns it). Rep/client dropdowns are gated on the relevant read permission
 * and degrade gracefully. Active filters show as removable chips. (No category filter — the report-list
 * endpoint filters by status/rep/client/period/date, not item category.) Tokens only.
 */
import { X } from 'lucide-react';
import { DatePicker, Select } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useClients, useReps } from '../api/useLookups';
import type { ExpenseFilters, ExpenseStatus } from '../expenses.types';
import styles from './expenses.module.css';

const ALL = '__all__';
const STATUS_OPTIONS = [
  { value: ALL, label: 'All statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'sent_back', label: 'Sent back' },
  { value: 'draft', label: 'Draft' },
];

export interface ExpenseFilterBarProps {
  filters: ExpenseFilters;
  onChange: (patch: Partial<ExpenseFilters>) => void;
}

export function ExpenseFilterBar({ filters, onChange }: ExpenseFilterBarProps) {
  const canViewReps = useCan('hrm:view');
  const canViewClients = useCan('clients:view');
  const reps = useReps(canViewReps);
  const clients = useClients(canViewClients);

  const repName = (id?: string) => {
    const r = reps.data?.find((x) => x.id === id);
    return r ? `${r.full_name} (${r.rep_code})` : (id ?? '');
  };
  const clientName = (id?: string) => clients.data?.find((c) => c.id === id)?.name ?? id ?? '';

  const chips: { label: string; clear: () => void }[] = [];
  if (filters.status) chips.push({ label: `Status: ${filters.status}`, clear: () => onChange({ status: undefined }) });
  if (filters.rep_id) chips.push({ label: `Rep: ${repName(filters.rep_id)}`, clear: () => onChange({ rep_id: undefined }) });
  if (filters.client_id) chips.push({ label: `Client: ${clientName(filters.client_id)}`, clear: () => onChange({ client_id: undefined }) });
  if (filters.from) chips.push({ label: `From ${filters.from}`, clear: () => onChange({ from: undefined }) });
  if (filters.to) chips.push({ label: `To ${filters.to}`, clear: () => onChange({ to: undefined }) });

  return (
    <div className={styles.bar}>
      <div className={styles.controls}>
        <div className={styles.control}>
          <Select
            aria-label="Status"
            options={STATUS_OPTIONS}
            value={filters.status ?? ALL}
            onValueChange={(v) => onChange({ status: v === ALL ? undefined : (v as ExpenseStatus) })}
          />
        </div>
        {canViewReps && (
          <div className={styles.control}>
            <Select
              aria-label="Rep"
              options={[{ value: ALL, label: 'All reps' }, ...(reps.data ?? []).map((r) => ({ value: r.id, label: `${r.full_name} (${r.rep_code})` }))]}
              value={filters.rep_id ?? ALL}
              onValueChange={(v) => onChange({ rep_id: v === ALL ? undefined : v })}
            />
          </div>
        )}
        {canViewClients && (
          <div className={styles.control}>
            <Select
              aria-label="Client"
              options={[{ value: ALL, label: 'All clients' }, ...(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
              value={filters.client_id ?? ALL}
              onValueChange={(v) => onChange({ client_id: v === ALL ? undefined : v })}
            />
          </div>
        )}
        <div className={styles.dateInput}>
          <DatePicker
            aria-label="From date"
            placeholder="From date"
            value={filters.from ?? ''}
            onChange={(v) => onChange({ from: v || undefined })}
          />
        </div>
        <div className={styles.dateInput}>
          <DatePicker
            aria-label="To date"
            placeholder="To date"
            value={filters.to ?? ''}
            onChange={(v) => onChange({ to: v || undefined })}
          />
        </div>
      </div>
      {chips.length > 0 && (
        <div className={styles.chips}>
          {chips.map((chip, i) => (
            <span key={i} className={styles.chip}>
              {chip.label}
              <button type="button" className={styles.chipX} aria-label={`Clear ${chip.label}`} onClick={chip.clear}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
