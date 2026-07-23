/**
 * ScopeSelector — the page-level client scope for the effective-dated commission RATES: every scope, the
 * global fallback only, or one client's own ladder. Filtering is server-side (`?client_id=`); the selection
 * also pre-fills the scope of a newly added schedule/rate. Clients are a REFERENCE read (`clients:view`) —
 * never a rate-stream join (#3). Without that permission only "all"/"global" are offered.
 */
import { Select } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useClients } from '../api/useCommission';
import { SCOPE_ALL, SCOPE_GLOBAL, type ScopeValue } from '../clientScope';
import styles from './commission.module.css';

export function ScopeSelector({ value, onChange }: { value: ScopeValue; onChange: (v: ScopeValue) => void }) {
  const canViewClients = useCan('clients:view');
  const clients = useClients(canViewClients);

  const options = [
    { value: SCOPE_ALL, label: 'All scopes' },
    { value: SCOPE_GLOBAL, label: 'Global (default for every client)' },
    ...(clients.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.client_code})` })),
  ];

  return (
    <div className={styles.scopeBar}>
      <label className={styles.scopeLabel} htmlFor="commission-scope">
        Applies to
      </label>
      <Select id="commission-scope" options={options} value={value} onValueChange={(v) => onChange(v as ScopeValue)} />
      <p className={styles.note}>
        A client&rsquo;s rates override the global ones for that client&rsquo;s sales. The internet tally that
        picks the tier still counts <strong>every client together</strong>.
      </p>
    </div>
  );
}
