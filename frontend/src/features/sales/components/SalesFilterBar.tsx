/**
 * SalesFilterBar — server-side filters (status/client/rep/date) for the sales list. Filter state lives
 * in the URL (the page owns it) and is passed here; changes call `onChange`. Client/rep dropdowns are
 * gated on the relevant read permission (clients:view / hrm:view) and degrade gracefully when absent.
 * Active filters show as removable chips. Tokens only.
 */
import { X } from 'lucide-react';
import { DatePicker, Select } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useClients, useReps } from '../api/useSales';
import type { SaleStatus, SalesFilters } from '../sales.types';
import styles from './SalesFilterBar.module.css';

const ALL = '__all__';
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: ALL, label: 'All statuses' },
  { value: 'entered', label: 'Entered' },
  { value: 'validated', label: 'Validated' },
  { value: 'in_pay_run', label: 'In Pay Run' },
  { value: 'paid', label: 'Paid' },
  { value: 'clawed_back', label: 'Clawed Back' },
  { value: 'deleted', label: 'Deleted' },
];

export interface SalesFilterBarProps {
  filters: SalesFilters;
  onChange: (patch: Partial<SalesFilters>) => void;
}

export function SalesFilterBar({ filters, onChange }: SalesFilterBarProps) {
  const canViewClients = useCan('clients:view');
  const canViewReps = useCan('hrm:view');
  const clients = useClients(canViewClients);
  const reps = useReps(canViewReps);

  const clientName = (id?: string) =>
    clients.data?.find((c) => c.id === id)?.name ?? id ?? '';
  const repName = (id?: string) => {
    const r = reps.data?.find((x) => x.id === id);
    return r ? `${r.full_name} (${r.rep_code})` : (id ?? '');
  };

  const chips: { label: string; clear: () => void }[] = [];
  if (filters.status) chips.push({ label: `Status: ${filters.status}`, clear: () => onChange({ status: undefined }) });
  if (filters.client_id) chips.push({ label: `Client: ${clientName(filters.client_id)}`, clear: () => onChange({ client_id: undefined }) });
  if (filters.rep_id) chips.push({ label: `Rep: ${repName(filters.rep_id)}`, clear: () => onChange({ rep_id: undefined }) });
  if (filters.date_from) chips.push({ label: `From ${filters.date_from}`, clear: () => onChange({ date_from: undefined }) });
  if (filters.date_to) chips.push({ label: `To ${filters.date_to}`, clear: () => onChange({ date_to: undefined }) });

  return (
    <div className={styles.bar}>
      <div className={styles.controls}>
        <div className={styles.control}>
          <Select
            aria-label="Status"
            options={STATUS_OPTIONS}
            value={filters.status ?? ALL}
            onValueChange={(v) => onChange({ status: v === ALL ? undefined : (v as SaleStatus) })}
          />
        </div>

        {canViewClients && (
          <div className={styles.control}>
            <Select
              aria-label="Client"
              placeholder="All clients"
              options={[
                { value: ALL, label: 'All clients' },
                ...(clients.data ?? []).map((c) => ({ value: c.id, label: c.name })),
              ]}
              value={filters.client_id ?? ALL}
              onValueChange={(v) => onChange({ client_id: v === ALL ? undefined : v })}
            />
          </div>
        )}

        {canViewReps && (
          <div className={styles.control}>
            <Select
              aria-label="Rep"
              placeholder="All reps"
              options={[
                { value: ALL, label: 'All reps' },
                ...(reps.data ?? []).map((r) => ({ value: r.id, label: `${r.full_name} (${r.rep_code})` })),
              ]}
              value={filters.rep_id ?? ALL}
              onValueChange={(v) => onChange({ rep_id: v === ALL ? undefined : v })}
            />
          </div>
        )}

        <div className={styles.date}>
          <DatePicker
            aria-label="Sale date from"
            placeholder="From date"
            value={filters.date_from ?? ''}
            onChange={(v) => onChange({ date_from: v || undefined })}
          />
        </div>
        <div className={styles.date}>
          <DatePicker
            aria-label="Sale date to"
            placeholder="To date"
            value={filters.date_to ?? ''}
            onChange={(v) => onChange({ date_to: v || undefined })}
          />
        </div>
      </div>

      {chips.length > 0 && (
        <div className={styles.chips}>
          {chips.map((chip, i) => (
            <span className={styles.chip} key={i}>
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
