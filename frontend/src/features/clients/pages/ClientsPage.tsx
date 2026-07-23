/**
 * ClientsPage — the clients management list (SRS §6, CLNT-001/006). Server-paginated via <DataTable> with
 * a status filter + free-text search + export; create and row edit/soft-deactivate. `clients:view` to see
 * (server-enforced; 403 → the DataTable's forbidden panel). Reuses the playbook. Touches ONLY /v1/clients* (#3).
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Input, PageHeader, Select } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { ExportMenu } from '../../../components/data/ExportMenu';
import type { ExportColumn } from '../../../lib/export/exportRows';
import { exportFilename } from '../../../lib/export/exportFilename';
import { todayIso } from '../../../lib/format/date';
import { ClientsTable } from '../components/ClientsTable';
import { ClientFormModal, type ClientFormState } from '../components/ClientFormModal';
import { fetchAllClients } from '../api/useClients';
import type { Client, ClientsFilters, StatusFilter } from '../clients.types';
import styles from '../components/clients.module.css';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

const EXPORT_COLUMNS: ExportColumn<Client>[] = [
  { header: 'Code', value: (c) => c.client_code },
  { header: 'Name', value: (c) => c.name },
  { header: 'Market', value: (c) => c.market },
  { header: 'MPU IDs', value: (c) => (c.supplies_mpu_id ? 'Yes' : 'No') },
  { header: 'Status', value: (c) => (c.is_active ? 'Active' : 'Inactive') },
];

/** Debounced free-text search — commits after the user pauses typing (server-side search). */
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);
  return (
    <Input
      type="search"
      placeholder="Search code or name…"
      aria-label="Search clients"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
    />
  );
}

export default function ClientsPage() {
  const canCreate = useCan('clients:create');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState<string>('');
  const [modal, setModal] = useState<ClientFormState>(null);

  const filters = useMemo<ClientsFilters>(() => ({ status, search: search || undefined }), [status, search]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Clients & Products"
        subtitle="Partner programs, their products, and billing rates."
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <SearchBox value={search} onChange={setSearch} />
            <Select options={STATUS_OPTIONS} value={status} onValueChange={(v) => setStatus(v as StatusFilter)} aria-label="Status filter" />
            <ExportMenu filename={exportFilename({ source: 'clients', generatedOn: todayIso() })} title="Clients" columns={EXPORT_COLUMNS} getRows={() => fetchAllClients(filters)} />
            {canCreate && (
              <Button variant="primary" onClick={() => setModal({ mode: 'create' })}>
                Create client
              </Button>
            )}
          </div>
        }
      />
      <ClientsTable filters={filters} onEdit={(c: Client) => setModal({ mode: 'edit', client: c })} />
      <ClientFormModal state={modal} onClose={() => setModal(null)} />
    </div>
  );
}
