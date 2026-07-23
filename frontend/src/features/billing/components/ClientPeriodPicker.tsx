/**
 * ClientPeriodPicker — the client + BILLING WEEK selection control, reused by the list filter and the
 * generate modal. Presentational: the page owns the data (reused `useClients` / `useBillingPeriods`).
 *
 * The week is the billing period ("Bill 17", Mon–Sun), NOT the pay period — pay periods run Sun–Sat
 * biweekly, so a bill straddles two of them and the two calendars must not be confused here.
 * Radix Select forbids an empty value, so "All" maps to a sentinel. Tokens only.
 */
import { FormField, Select } from '../../../components/ui';
import { billLabel } from '../billing.logic';
import styles from './billing.module.css';
import type { Client } from '../../clients/clients.types';
import type { BillingPeriod } from '../billing.types';

const ALL = '__all__';

interface Props {
  clients: Client[];
  periods: BillingPeriod[];
  clientId?: string;
  periodId?: string;
  onClient: (id: string | undefined) => void;
  onPeriod: (id: string | undefined) => void;
  /** Add an "All" option (list filter). Omit for the required selection in the generate modal. */
  allowAll?: boolean;
  disabled?: boolean;
}

export function ClientPeriodPicker({ clients, periods, clientId, periodId, onClient, onPeriod, allowAll, disabled }: Props) {
  const clientOptions = [
    ...(allowAll ? [{ value: ALL, label: 'All clients' }] : []),
    ...clients.map((c) => ({ value: c.id, label: `${c.name} (${c.client_code})` })),
  ];
  const periodOptions = [
    ...(allowAll ? [{ value: ALL, label: 'All weeks' }] : []),
    ...periods.map((p) => ({ value: p.id, label: billLabel(p) })),
  ];

  return (
    <div className={styles.controls}>
      <div className={styles.control}>
        <FormField label="Client">
          <Select
            placeholder="Select a client"
            options={clientOptions}
            value={clientId ?? (allowAll ? ALL : undefined)}
            onValueChange={(v) => onClient(v === ALL ? undefined : v)}
            disabled={disabled}
          />
        </FormField>
      </div>
      <div className={styles.control}>
        <FormField label="Billing week" help="Mon–Sun. Separate from the pay period.">
          <Select
            placeholder="Select a week"
            options={periodOptions}
            value={periodId ?? (allowAll ? ALL : undefined)}
            onValueChange={(v) => onPeriod(v === ALL ? undefined : v)}
            disabled={disabled}
          />
        </FormField>
      </div>
    </div>
  );
}
