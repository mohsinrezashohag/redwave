/**
 * SaleDetailPage — the deep-linkable `/sales/:id` route. Reads the id from the path and hands it to
 * SaleDetailView (which fetches, gates actions, and handles loading/error/not-found). — SALE-004
 */
import { useParams } from 'react-router-dom';
import { PageHeader } from '../../../components/ui';
import { SaleDetailView } from '../components/SaleDetailView';

export default function SaleDetailPage() {
  const { id = '' } = useParams<{ id: string }>();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader title="Sale detail" />
      <SaleDetailView id={id} />
    </div>
  );
}
