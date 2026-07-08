/**
 * ProductTypesPage — the SA product-type catalogue manager (SRS §6 / §7). Lists the catalogue on the shared
 * <DataTable> (key · label · behaviour · status), with Add + per-row Edit. A NEW type is always a standard
 * add-on (the form enforces it). Gated product_types:view (page) / product_types:edit (writes) — its own RBAC
 * module, so it can be granted without all Commission Config access. The server is the real gate (§5); 403 → AccessDenied.
 */
import { useMemo, useState } from 'react';
import { Badge, Button, PageHeader } from '../../../components/ui';
import { DataTable, type DataColumn } from '../../../components/data/DataTable';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useProductTypes } from '../api/useProductTypes';
import { behaviourLabel, behaviourTone } from '../productTypeBehaviour';
import { ProductTypeFormModal, type ProductTypeFormState } from '../components/ProductTypeFormModal';
import type { ProductType } from '../productTypes.types';

export default function ProductTypesPage() {
  const canView = useCan('product_types:view');
  const canEdit = useCan('product_types:edit');
  const q = useProductTypes('all', canView);
  const [modal, setModal] = useState<ProductTypeFormState>(null);

  const rows = useMemo(() => q.data ?? [], [q.data]);

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Managing product types requires the product types permission." />;
  }

  const columns: DataColumn<ProductType>[] = [
    { id: 'key', header: 'Key', render: (t) => <code>{t.key}</code> },
    { id: 'label', header: 'Label', render: (t) => t.label },
    { id: 'behaviour', header: 'Behaviour', render: (t) => <Badge tone={behaviourTone(t.behaviour)}>{behaviourLabel(t.behaviour)}</Badge> },
    {
      id: 'status',
      header: 'Status',
      render: (t) => (
        <Badge tone={t.is_active ? 'success' : 'neutral'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>
      ),
    },
    { id: 'kind', header: '', render: (t) => (t.is_system ? <Badge tone="info">Core</Badge> : null) },
  ];

  return (
    <div>
      <PageHeader
        title="Product types"
        subtitle="The catalogue of product types and their commission behaviour. New types are standard add-ons — they’re billable and flat-rated but never count toward the internet tier tally."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setModal({ mode: 'create' })}>
              Add product type
            </Button>
          )
        }
      />
      <DataTable<ProductType>
        columns={columns}
        rows={rows}
        getRowId={(t) => t.key}
        page={1}
        pageCount={1}
        total={rows.length}
        limit={rows.length || 1}
        onPageChange={() => {}}
        rowActions={
          canEdit
            ? (t) => (
                <Button variant="tertiary" size="sm" onClick={() => setModal({ mode: 'edit', type: t })}>
                  Edit
                </Button>
              )
            : undefined
        }
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        onRetry={() => void q.refetch()}
        emptyNode={<p className="mono">No product types configured.</p>}
        aria-label="Product types"
      />
      <ProductTypeFormModal state={modal} onClose={() => setModal(null)} />
    </div>
  );
}
