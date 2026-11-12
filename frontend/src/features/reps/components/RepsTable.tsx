/**
 * RepsTable — the HRM rep roster on the shared <DataTable> (server pagination/sort + the FORBIDDEN state).
 * Columns: code · name · status · field manager (name resolved via users:view, else hidden) · hire date.
 * With hrm:edit the rows are selectable and a bulk "Assign manager" action reassigns the field manager.
 * Convenience gating only — the server is the real gate (§5).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './reps.module.css';
import { Badge, Button, PersonName } from '../../../components/ui';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { useCan } from '../../../auth/useCan';
import { displayDate } from '../../../lib/format/date';
import { useUsers } from '../../admin/api/useUsers';
import { useRepsTable } from '../api/useReps';
import { AssignManagerModal } from './AssignManagerModal';
import type { Rep, RepSortKey, RepsFilters } from '../reps.types';

export function RepsTable({ filters }: { filters: RepsFilters }) {
  const list = useRepsTable(filters);
  const canViewUsers = useCan('users:view');
  const canEdit = useCan('hrm:edit');
  const users = useUsers(canViewUsers);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);

  const managerCell = (id: string) => {
    const u = users.data?.find((x) => x.id === id);
    return u ? <PersonName name={u.full_name} photoUrl={u.avatar_url} /> : '—';
  };
  const managerOptions = useMemo(
    () =>
      (users.data ?? [])
        .filter((u) => u.status === 'active' && u.user_roles.some((r) => r.role.name === 'Manager'))
        .map((u) => ({ value: u.id, label: u.full_name })),
    [users.data],
  );

  const toggle = (id: string, next: boolean) =>
    setSelectedIds((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });
  const toggleAll = () =>
    setSelectedIds((prev) => (prev.size === list.rows.length ? new Set() : new Set(list.rows.map((r) => r.id))));

  const columns: DataColumn<Rep, RepSortKey>[] = [
    { id: 'rep_code', header: 'Code', sortKey: 'rep_code', render: (r) => <span className="mono">{r.rep_code}</span> },
    {
      id: 'full_name',
      header: 'Name',
      sortKey: 'full_name',
      render: (r) => (
        <PersonName
          name={r.full_name}
          photoUrl={r.photo_url}
          renderName={(name) => (
            <Link to={`/admin/reps/${r.id}`} className={styles.nameLink}>
              {name}
            </Link>
          )}
        />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status === 'active' ? 'Active' : 'Terminated'}</Badge>,
    },
    ...(canViewUsers ? [{ id: 'manager', header: 'Field manager', render: (r: Rep) => managerCell(r.field_manager_id) }] : []),
    { id: 'hire_date', header: 'Hired', sortKey: 'hire_date', render: (r) => displayDate(r.hire_date) },
  ];

  const selectionProps = canEdit
    ? {
        selectedIds,
        onSelect: toggle,
        onToggleAll: toggleAll,
        allSelectableSelected: list.rows.length > 0 && selectedIds.size === list.rows.length,
        bulkActions: (
          <Button variant="primary" size="sm" onClick={() => setAssignOpen(true)}>
            Assign manager
          </Button>
        ),
      }
    : {};

  return (
    <>
      <DataTable<Rep, RepSortKey>
        columns={columns}
        rows={list.rows}
        getRowId={(r) => r.id}
        sort={{ key: list.sort.key, dir: list.sort.dir }}
        onSortChange={list.toggleSort}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
        limit={list.limit}
        onPageChange={list.setPage}
        isLoading={list.isLoading}
        isError={list.isError}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyNode={<p className="mono">No reps match these filters.</p>}
        forbiddenMessage="You don’t have permission to view reps."
        aria-label="Reps"
        {...selectionProps}
      />
      <AssignManagerModal
        open={assignOpen}
        repIds={[...selectedIds]}
        managerOptions={managerOptions}
        onClose={() => setAssignOpen(false)}
        onDone={() => {
          setAssignOpen(false);
          setSelectedIds(new Set());
        }}
      />
    </>
  );
}
