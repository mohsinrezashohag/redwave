/**
 * RepsListPage — the HRM rep roster screen (unblocks the previously dead "Reps" nav tab). Server-paginated
 * via <DataTable> with a status filter + free-text search (code/name) + export. `hrm:view` to see
 * (server-enforced; 403 → the DataTable's forbidden panel). Read-only roster; rep CRUD is a future screen.
 */
import { useEffect, useMemo, useState } from 'react';
import { Input, PageHeader, Select } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { ExportMenu } from '../../../components/data/ExportMenu';
import type { ExportColumn } from '../../../lib/export/exportRows';
import { displayDate, todayIso } from '../../../lib/format/date';
import { exportFilename } from '../../../lib/export/exportFilename';
import { useUsers } from '../../admin/api/useUsers';
import { RepsTable } from '../components/RepsTable';
import { fetchAllReps } from '../api/useReps';
import type { Rep, RepStatusFilter, RepsFilters } from '../reps.types';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'all', label: 'All' },
];
const ALL_MANAGERS = '__all__';

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
  return <Input type="search" placeholder="Search code or name…" aria-label="Search reps" value={local} onChange={(e) => setLocal(e.target.value)} />;
}

export default function RepsListPage() {
  const canView = useCan('hrm:view');
  const canViewUsers = useCan('users:view');
  const [status, setStatus] = useState<RepStatusFilter>('active');
  const [search, setSearch] = useState('');
  const [managerId, setManagerId] = useState<string>(ALL_MANAGERS);

  const users = useUsers(canView && canViewUsers);
  const managerOptions = useMemo(
    () => [
      { value: ALL_MANAGERS, label: 'All managers' },
      ...(users.data ?? [])
        .filter((u) => u.user_roles.some((r) => r.role.name === 'Manager'))
        .map((u) => ({ value: u.id, label: u.full_name })),
    ],
    [users.data],
  );

  const filters = useMemo<RepsFilters>(
    () => ({ status, search: search || undefined, fieldManagerId: managerId === ALL_MANAGERS ? undefined : managerId }),
    [status, search, managerId],
  );

  const exportColumns: ExportColumn<Rep>[] = [
    { header: 'Code', value: (r) => r.rep_code },
    { header: 'Name', value: (r) => r.full_name },
    { header: 'Status', value: (r) => (r.status === 'active' ? 'Active' : 'Terminated') },
    { header: 'Hired', value: (r) => displayDate(r.hire_date) },
  ];

  if (!canView) {
    return <AccessDenied message="Viewing reps requires the HRM view permission." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader
        title="Reps"
        subtitle="The field-rep roster. Codes are permanent and never reused — terminated reps keep their code."
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <SearchBox value={search} onChange={setSearch} />
            <Select options={STATUS_OPTIONS} value={status} onValueChange={(v) => setStatus(v as RepStatusFilter)} aria-label="Status filter" />
            {canViewUsers && managerOptions.length > 1 && (
              <Select options={managerOptions} value={managerId} onValueChange={setManagerId} aria-label="Manager filter" />
            )}
            <ExportMenu filename={exportFilename({ source: 'reps', generatedOn: todayIso() })} title="Reps" columns={exportColumns} getRows={() => fetchAllReps(filters)} />
          </div>
        }
      />
      <RepsTable filters={filters} />
    </div>
  );
}
