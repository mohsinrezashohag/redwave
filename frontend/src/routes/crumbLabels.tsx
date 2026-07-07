/**
 * crumbLabels — dynamic breadcrumb segments for detail routes. Each kind is its OWN component (rules of
 * hooks) calling the page's EXISTING query hook with the SAME query key — React Query dedupes/shares the
 * cache, so the crumb never fires a duplicate fetch. While loading → a subtle skeleton segment; on
 * failure/missing → the truncated id. These import only the light feature api/hooks modules.
 */
/* eslint-disable react-refresh/only-export-components -- this module's purpose is the kind→component map */
import type { ComponentType } from 'react';
import { Skeleton } from '../components/ui';
import { useSaleQuery } from '../features/sales/api/useSales';
import { useClient } from '../features/clients/api/useClients';
import { usePayRun } from '../features/payrun/api/usePayRun';
import { useDocument } from '../features/documents/api/useDocuments';
import { useExpenseItem } from '../features/expenses/api/useExpenseItems';
import { useStatement } from '../features/billing/api/useBilling';
import { useExpenseDoc } from '../features/expenseDocs/api/useExpenseDocs';
import { expenseDocNo } from '../features/expenseDocs/expenseDocs.download';
import { useRole } from '../features/admin/api/useRoles';
import { useImportBatch } from '../features/import/api/useImports';
import { categoryLabel } from '../features/expenses/format';
import { statementNo } from '../features/billing/billing.logic';
import type { DynamicKind } from './crumbs';

const shortId = (id: string): string => `${id.slice(0, 8)}…`;

/** Render the resolved label, a loading skeleton, or the truncated-id fallback. */
function Resolved({ label, isLoading, id }: { label: string | undefined | null; isLoading: boolean; id: string }) {
  if (label) return <>{label}</>;
  if (isLoading) return <Skeleton width="72px" height="12px" />;
  return <>{shortId(id)}</>;
}

function SaleCrumb({ id }: { id: string }) {
  const q = useSaleQuery(id);
  return <Resolved label={q.data?.sale_code} isLoading={q.isLoading} id={id} />;
}
function ClientCrumb({ id }: { id: string }) {
  const q = useClient(id);
  return <Resolved label={q.data?.name} isLoading={q.isLoading} id={id} />;
}
function PayRunCrumb({ id }: { id: string }) {
  const q = usePayRun(id);
  const n = q.data?.pay_period?.period_number;
  return <Resolved label={n != null ? `Period #${n}` : undefined} isLoading={q.isLoading} id={id} />;
}
function DocumentCrumb({ id }: { id: string }) {
  const q = useDocument(id);
  return <Resolved label={q.data?.title} isLoading={q.isLoading} id={id} />;
}
function ExpenseItemCrumb({ id }: { id: string }) {
  const q = useExpenseItem(id);
  return <Resolved label={q.data ? categoryLabel(q.data.category) : undefined} isLoading={q.isLoading} id={id} />;
}
function StatementCrumb({ id }: { id: string }) {
  const q = useStatement(id);
  return (
    <Resolved
      label={q.data != null ? statementNo(q.data.statement_number) : undefined}
      isLoading={q.isLoading}
      id={id}
    />
  );
}
function ExpenseDocCrumb({ id }: { id: string }) {
  const q = useExpenseDoc(id);
  return <Resolved label={q.data != null ? expenseDocNo(q.data.document_number) : undefined} isLoading={q.isLoading} id={id} />;
}
function RoleCrumb({ id }: { id: string }) {
  const q = useRole(id);
  return <Resolved label={q.data?.name} isLoading={q.isLoading} id={id} />;
}
function ImportBatchCrumb({ id }: { id: string }) {
  const q = useImportBatch(id);
  const b = q.data;
  return <Resolved label={b ? `${b.source_type} · ${b.import_type}` : undefined} isLoading={q.isLoading} id={id} />;
}

export const DYNAMIC_CRUMBS: Record<DynamicKind, ComponentType<{ id: string }>> = {
  sale: SaleCrumb,
  client: ClientCrumb,
  payrun: PayRunCrumb,
  document: DocumentCrumb,
  expenseItem: ExpenseItemCrumb,
  statement: StatementCrumb,
  expenseDoc: ExpenseDocCrumb,
  role: RoleCrumb,
  importBatch: ImportBatchCrumb,
};
