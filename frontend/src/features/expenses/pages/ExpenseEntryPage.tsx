/**
 * ExpenseEntryPage — add one or several expense items (`expenses:create`, item-first). Loads the field
 * configs (the dynamic categories + receipt rule) and clients (optional tagging) before rendering the form.
 * 403 → AccessDenied.
 */
import { PageHeader } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useFieldConfigs } from '../api/useExpenseItems';
import { useClients } from '../api/useLookups';
import { ExpenseForm } from '../components/ExpenseForm';
import styles from '../components/expenses.module.css';

export default function ExpenseEntryPage() {
  const canCreate = useCan('expenses:create');
  const canViewClients = useCan('clients:view');
  const configs = useFieldConfigs(canCreate);
  const clients = useClients(canCreate && canViewClients);

  if (!canCreate || isForbidden(configs.error)) {
    return <AccessDenied message="Adding expenses requires the expenses create permission." />;
  }

  const clientOptions = (clients.data ?? []).map((c) => ({ value: c.id, label: c.name }));
  return (
    <div className={styles.page}>
      <PageHeader
        title="Add expense"
        subtitle="Pick a category and fill in the details. Add several at once — the km amount is computed on submit."
      />
      <DataState isLoading={configs.isLoading} isError={configs.isError} isEmpty={false} onRetry={() => configs.refetch()}>
        {configs.data && <ExpenseForm mode="create" configs={configs.data} clientOptions={clientOptions} />}
      </DataState>
    </div>
  );
}
