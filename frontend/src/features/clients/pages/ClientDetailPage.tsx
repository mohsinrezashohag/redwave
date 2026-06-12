/**
 * ClientDetailPage — a client's header (+ edit) + its Products + the effective-dated Billing rates panel
 * (the deep-linkable detail route, like the role editor). `clients:view` to see; edit/add gated by useCan.
 * 403 → AccessDenied. Touches ONLY /v1/clients* (#3).
 */
import { Fragment, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, PageHeader } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useClient, useClientProducts } from '../api/useClients';
import { ClientStatusBadge } from '../components/ClientStatusBadge';
import { ClientFormModal, type ClientFormState } from '../components/ClientFormModal';
import { ProductsTable } from '../components/ProductsTable';
import { ProductFormModal, type ProductFormState } from '../components/ProductFormModal';
import { BillingRatesPanel } from '../components/BillingRatesPanel';
import type { Product } from '../clients.types';
import styles from '../components/clients.module.css';

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canView = useCan('clients:view');
  const canEdit = useCan('clients:edit');
  const client = useClient(id);
  const products = useClientProducts(id, canView);
  const [clientModal, setClientModal] = useState<ClientFormState>(null);
  const [productModal, setProductModal] = useState<ProductFormState>(null);

  if (!canView || isForbidden(client.error)) {
    return <AccessDenied message="Viewing clients requires the clients view permission." />;
  }

  const productRows = products.data ?? [];
  const c = client.data;
  return (
    <div className={styles.page}>
      <PageHeader title={c?.name ?? 'Client'} />
      <DataState isLoading={client.isLoading} isError={client.isError} isEmpty={false} onRetry={() => client.refetch()}>
        {c && (
          <>
            <Card
              title="Client"
              actions={canEdit ? <Button variant="secondary" size="sm" onClick={() => setClientModal({ mode: 'edit', client: c })}>Edit</Button> : undefined}
            >
              <div className={styles.detailHead}>
                <span className={styles.codeCell}>{c.client_code}</span>
                <ClientStatusBadge active={c.is_active} />
              </div>
              <dl className={styles.dl} style={{ marginTop: 'var(--space-3)' }}>
                <dt>Market</dt>
                <dd>{c.market}</dd>
                <dt>Supplies MPU IDs</dt>
                <dd>{c.supplies_mpu_id ? 'Yes' : 'No'}</dd>
                <dt>Created</dt>
                <dd className="mono">{displayDate(c.created_at)}</dd>
                {(c.custom_fields ?? []).map((f) => (
                  <Fragment key={f.id}>
                    <dt>{f.field_name}</dt>
                    <dd>{f.field_value}</dd>
                  </Fragment>
                ))}
              </dl>
            </Card>

            <Card
              title="Products"
              actions={canEdit ? <Button variant="secondary" size="sm" onClick={() => setProductModal({ mode: 'create', clientId: c.id })}>Add product</Button> : undefined}
            >
              <DataState
                isLoading={products.isLoading}
                isError={products.isError}
                isEmpty={productRows.length === 0}
                onRetry={() => products.refetch()}
                emptyNode={<p className={styles.supersedeNote}>No products yet.</p>}
              >
                <ProductsTable products={productRows} onEdit={(p: Product) => setProductModal({ mode: 'edit', product: p })} />
              </DataState>
            </Card>

            <Card title="Billing rates">
              <BillingRatesPanel clientId={c.id} products={productRows} />
            </Card>
          </>
        )}
      </DataState>

      <ClientFormModal state={clientModal} onClose={() => setClientModal(null)} />
      <ProductFormModal state={productModal} onClose={() => setProductModal(null)} />
    </div>
  );
}
