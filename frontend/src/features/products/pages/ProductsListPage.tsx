/**
 * ProductsListPage — the cross-client products management screen (the new GET /v1/products surface).
 * Server-paginated via <DataTable> with client / type / status filters + free-text search + export.
 * `clients:view` to see (server-enforced; 403 → the DataTable's forbidden panel). Products are created
 * per-client from the client's detail page (product_type is immutable per client). Touches /v1/products
 * + /v1/clients (names) only (#3).
 */
import { useEffect, useMemo, useState } from 'react';
import { Input, PageHeader, Select } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { ExportMenu } from '../../../components/data/ExportMenu';
import type { ExportColumn } from '../../../lib/export/exportRows';
import { productTypeLabel } from '../../../lib/format/productType';
import { useClients } from '../../clients/api/useClients';
import { useProductTypes } from '../../productTypes/api/useProductTypes';
import { ProductsTable } from '../components/ProductsTable';
import { fetchAllProducts } from '../api/useProducts';
import type { Product, ProductStatusFilter, ProductType, ProductsFilters } from '../products.types';

const ALL = '__all__';
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

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
  return (
    <Input type="search" placeholder="Search product name…" aria-label="Search products" value={local} onChange={(e) => setLocal(e.target.value)} />
  );
}

export default function ProductsListPage() {
  const canView = useCan('clients:view');
  const clients = useClients('all', canView);
  const types = useProductTypes('all', canView);
  const typeFilterOptions = [
    { value: ALL, label: 'All types' },
    ...(types.data ?? []).map((t) => ({ value: t.key, label: t.label })),
  ];
  const [status, setStatus] = useState<ProductStatusFilter>('active');
  const [clientId, setClientId] = useState<string | undefined>(undefined);
  const [productType, setProductType] = useState<ProductType | undefined>(undefined);
  const [search, setSearch] = useState('');

  const filters = useMemo<ProductsFilters>(
    () => ({ status, client_id: clientId, product_type: productType, search: search || undefined }),
    [status, clientId, productType, search],
  );

  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? id;
  const exportColumns: ExportColumn<Product>[] = [
    { header: 'Name', value: (p) => p.name },
    { header: 'Type', value: (p) => productTypeLabel(p.product_type) },
    { header: 'Client', value: (p) => clientName(p.client_id) },
    { header: 'Status', value: (p) => (p.is_active ? 'Active' : 'Inactive') },
  ];

  if (!canView) {
    return <AccessDenied message="Viewing products requires the clients view permission." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader
        title="Products"
        subtitle="Every per-client product across all partners. Create products from a client’s detail page."
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <SearchBox value={search} onChange={setSearch} />
            <Select
              aria-label="Client filter"
              placeholder="All clients"
              options={[{ value: ALL, label: 'All clients' }, ...(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
              value={clientId ?? ALL}
              onValueChange={(v) => setClientId(v === ALL ? undefined : v)}
            />
            <Select
              aria-label="Type filter"
              options={typeFilterOptions}
              value={productType ?? ALL}
              onValueChange={(v) => setProductType(v === ALL ? undefined : (v as ProductType))}
            />
            <Select options={STATUS_OPTIONS} value={status} onValueChange={(v) => setStatus(v as ProductStatusFilter)} aria-label="Status filter" />
            <ExportMenu filename="products" title="Products" columns={exportColumns} getRows={() => fetchAllProducts(filters)} />
          </div>
        }
      />
      <ProductsTable filters={filters} />
    </div>
  );
}
