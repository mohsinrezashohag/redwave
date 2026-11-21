/**
 * UsersPage — user management (SRS §4; design-system §10.6). List users with roles + status; INVITE (emails
 * a set-password link), edit, assign roles, reset password (link/temp), soft-deactivate. `users:view` to see;
 * create/edit gated by `useCan` (convenience — the server enforces). A 403 renders AccessDenied.
 */
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Button, PageHeader } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useUsers } from '../api/useUsers';
import { UsersTable } from '../components/UsersTable';
import { UserFormModal, type UserFormState } from '../components/UserFormModal';
import type { AdminUser } from '../users.types';
import styles from '../admin.module.css';

export default function UsersPage() {
  const canView = useCan('users:view');
  const canCreate = useCan('users:create');
  const q = useUsers(canView);
  const [modal, setModal] = useState<UserFormState>(null);

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Viewing users requires the users view permission." />;
  }

  const users = q.data ?? [];
  return (
    <div className={styles.page}>
      <PageHeader
        title="Users"
        subtitle="Create users, assign roles, and manage access."
        actions={
          canCreate ? (
            <Button leftIcon={<UserPlus size={16} />} variant="primary" onClick={() => setModal({ mode: 'create' })}>
              Invite user
            </Button>
          ) : undefined
        }
      />
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={users.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={<p className="mono">No users yet.</p>}
      >
        <UsersTable users={users} onEdit={(u: AdminUser) => setModal({ mode: 'edit', user: u })} />
      </DataState>
      <UserFormModal state={modal} onClose={() => setModal(null)} />
    </div>
  );
}
