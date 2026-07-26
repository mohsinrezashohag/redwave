/**
 * ProductsTable — a client's products with row actions (edit, soft-deactivate/reactivate). product_type is
 * shown but immutable. Deactivation preserves history (never a delete). Tokens only.
 */
import { Pencil, Power, PowerOff } from 'lucide-react';
import {
  Badge,
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
import { useApiErrorToast } from '../../../lib/api/apiError';
import { productTypeLabel } from '../../../lib/format/productType';
import { useUpdateProduct } from '../api/useClientMutations';
import { ClientStatusBadge } from './ClientStatusBadge';
import type { Product } from '../clients.types';

export function ProductsTable({ products, onEdit }: { products: Product[]; onEdit: (p: Product) => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const update = useUpdateProduct();

  const setActive = (p: Product, is_active: boolean) =>
    update.mutate(
      { id: p.id, body: { is_active } },
      { onSuccess: () => toast({ title: is_active ? 'Product reactivated' : 'Product deactivated', tone: 'success' }), onError },
    );

  const rowMenu = (p: Product): MenuEntry[] => [
    { label: 'Edit', icon: <Pencil size={15} />, onSelect: () => onEdit(p) },
    'separator',
    p.is_active
      ? { label: 'Deactivate', icon: <PowerOff size={15} />, danger: true, onSelect: () => setActive(p, false) }
      : { label: 'Reactivate', icon: <Power size={15} />, onSelect: () => setActive(p, true) },
  ];

  return (
    <Table density="comfortable">
      <THead>
        <TR>
          <TH>Name</TH>
          <TH>Type</TH>
          <TH>Status</TH>
          <TH align="right">Actions</TH>
        </TR>
      </THead>
      <TBody>
        {products.map((p) => (
          <TR key={p.id}>
            <TD>{p.name}</TD>
            <TD>
              <Badge tone="neutral">{productTypeLabel(p.product_type)}</Badge>
            </TD>
            <TD>
              <ClientStatusBadge active={p.is_active} />
            </TD>
            <TD align="right">
              <RowActions label="Product actions" items={rowMenu(p)} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
