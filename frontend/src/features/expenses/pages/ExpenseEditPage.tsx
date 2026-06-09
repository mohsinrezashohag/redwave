/**
 * ExpenseEditPage — edit a single expense item (`expenses:edit`, item-first). EDIT-RIGHTS (EXP-007):
 * pre-approval needs expenses:edit; an APPROVED item is editable only by a Super Admin (else 403). The UI
 * applies the same gate; the server is the real gate. PATCH replaces the item (the form rebuilds it).
 */
import { useParams } from 'react-router-dom';
import { Breadcrumbs, PageHeader } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useFieldConfigs, useExpenseItem } from '../api/useExpenseItems';
import { useClients } from '../api/useLookups';
import { ExpenseForm } from '../components/ExpenseForm';
import styles from '../components/expenses.module.css';

export default function ExpenseEditPage() {
  const { id } = useParams<{ id: string }>();
  const { isSuperAdmin } = useAuth();
  const canEdit = useCan('expenses:edit');
  const canViewClients = useCan('clients:view');

  const item = useExpenseItem(id);
  const configs = useFieldConfigs(canEdit);
  const clients = useClients(canEdit && canViewClients);

  if (!canEdit || isForbidden(item.error) || isForbidden(configs.error)) {
    return <AccessDenied message="Editing expenses requires the expenses edit permission." />;
  }

  // Edit-rights gate (mirrors the server): approved → Super Admin only.
  if (item.data && item.data.status === 'approved' && !isSuperAdmin) {
    return <AccessDenied message="An approved expense item can only be edited by a Super Admin." />;
  }

  const ready = !!item.data && !!configs.data;
  const clientOptions = (clients.data ?? []).map((c) => ({ value: c.id, label: c.name }));
  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'Expenses', href: '/expenses' }, { label: 'Edit expense' }]} />}
        title="Edit expense item"
      />
      <DataState
        isLoading={item.isLoading || configs.isLoading}
        isError={item.isError || configs.isError}
        isEmpty={false}
        onRetry={() => {
          void item.refetch();
          void configs.refetch();
        }}
      >
        {ready && <ExpenseForm mode="edit" item={item.data} configs={configs.data!} clientOptions={clientOptions} />}
      </DataState>
    </div>
  );
}
