/**
 * RolesPage — the roles list (SRS AUTH-003/004). Each role shows a Built-in badge when protected, its
 * permission count and user count. Create a custom role or edit any role's permissions (→ the matrix
 * editor). DELETE is offered only for CUSTOM roles (built-in → the server 409s and the UI doesn't offer
 * it). `roles:view` to see; create/delete gated by `useCan`. Reuses the playbook.
 */
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Modal,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
  type MenuEntry,
} from '../../../components/ui';
import { RowActions } from '../../../components/data/RowActions';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useDeleteRole, useRoles } from '../api/useRoles';
import { BuiltInBadge } from '../components/RoleEditor';
import type { RoleSummary } from '../roles.types';
import styles from '../admin.module.css';

export default function RolesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const canView = useCan('roles:view');
  const canCreate = useCan('roles:create');
  const canDelete = useCan('roles:delete');
  const q = useRoles(canView);
  const del = useDeleteRole();
  const [confirm, setConfirm] = useState<RoleSummary | null>(null);

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Viewing roles requires the roles view permission." />;
  }

  const roles = q.data ?? [];

  const doDelete = () =>
    confirm &&
    del.mutate(confirm.id, {
      onSuccess: () => {
        toast({ title: 'Role deleted', tone: 'success' });
        setConfirm(null);
      },
      onError,
    });

  const rowMenu = (r: RoleSummary): MenuEntry[] => {
    const items: MenuEntry[] = [
      { label: r.is_system ? 'View / edit permissions' : 'Edit', icon: <Pencil size={15} />, onSelect: () => navigate(`/admin/roles/${r.id}`) },
    ];
    if (canDelete && !r.is_system) {
      items.push('separator', { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => setConfirm(r) });
    }
    return items;
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Build roles from a module × action permission matrix."
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => navigate('/admin/roles/new')}>
              New role
            </Button>
          ) : undefined
        }
      />
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={roles.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={<p className="mono">No roles yet.</p>}
      >
        <Table density="comfortable">
          <THead>
            <TR>
              <TH>Role</TH>
              <TH align="right">Permissions</TH>
              <TH align="right">Users</TH>
              <TH align="right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {roles.map((r) => (
              <TR key={r.id}>
                <TD>
                  <span className={styles.roleNameCell}>
                    <span className={styles.roleName}>{r.name}</span>
                    {r.is_system && <BuiltInBadge />}
                  </span>
                  {r.description && <span className={styles.roleDesc}>{r.description}</span>}
                </TD>
                <TD numeric>{r._count.role_permissions}</TD>
                <TD numeric>{r._count.user_roles}</TD>
                <TD align="right">
                  <RowActions label="Role actions" items={rowMenu(r)} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </DataState>

      <Modal
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this role?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={del.isPending} onClick={doDelete}>
              Delete role
            </Button>
          </>
        }
      >
        <strong>{confirm?.name}</strong> will be removed and unassigned from any users who hold it. This
        can&rsquo;t be undone.
      </Modal>
    </div>
  );
}
