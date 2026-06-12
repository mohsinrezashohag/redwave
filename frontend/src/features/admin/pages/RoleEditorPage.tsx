/**
 * RoleEditorPage — the deep-linkable role editor: `/admin/roles/new` (create) and `/admin/roles/:id`
 * (edit). Loads the RBAC catalogue (modules + permissions = the matrix axes) and, when editing, the role.
 * Gated by `useCan` (create needs roles:create, edit needs roles:edit); a 403 renders AccessDenied. The
 * matrix is too big for a modal, so this is a route (the playbook's detail pattern). — SRS AUTH-004
 */
import { useParams } from 'react-router-dom';
import { PageHeader } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useModules, usePermissions } from '../api/useRbacCatalogue';
import { useRole } from '../api/useRoles';
import { BuiltInBadge, RoleEditor } from '../components/RoleEditor';
import styles from '../admin.module.css';

export default function RoleEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;

  const canCreate = useCan('roles:create');
  const canEdit = useCan('roles:edit');
  const allowed = isNew ? canCreate : canEdit;

  const modules = useModules(allowed);
  const permissions = usePermissions(allowed);
  const role = useRole(isNew ? undefined : id);

  if (!allowed) {
    return <AccessDenied message="Editing roles requires the roles edit permission." />;
  }
  if (isForbidden(modules.error) || isForbidden(permissions.error) || isForbidden(role.error)) {
    return <AccessDenied message="You don’t have access to the role catalogue." />;
  }

  const loading = modules.isLoading || permissions.isLoading || (!isNew && role.isLoading);
  const error = modules.isError || permissions.isError || (!isNew && role.isError);
  const ready = !!modules.data && !!permissions.data && (isNew || !!role.data);
  const roleName = isNew ? 'New role' : role.data?.name ?? 'Role';

  return (
    <div className={styles.page}>
      <PageHeader
        title={
          <span className={styles.roleNameCell}>
            {roleName}
            {role.data?.is_system && <BuiltInBadge />}
          </span>
        }
      />
      <DataState isLoading={loading} isError={error} isEmpty={false} onRetry={() => { void modules.refetch(); void permissions.refetch(); if (!isNew) void role.refetch(); }}>
        {ready && (
          <RoleEditor role={isNew ? undefined : role.data} modules={modules.data!} permissions={permissions.data!} />
        )}
      </DataState>
    </div>
  );
}
