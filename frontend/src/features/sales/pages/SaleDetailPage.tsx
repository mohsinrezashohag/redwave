/**
 * SaleDetailPage — the deep-linkable `/sales/:id` route. Reads the id from the path and hands it to
 * SaleDetailView (which fetches, gates actions, and handles loading/error/not-found). — SALE-004
 *
 * This is also the CONFIRMATION screen: SaleForm routes here on a successful create. So the header pairs
 * the two things a rep wants next — back to the list, or straight into the next entry — top-right where
 * they are found without hunting. NAVIGATION only; the actions that act on THIS sale (validate /
 * greenfield / delete) stay with the record in SaleDetailView. `sales:create` is convenience gating; the
 * server is the real gate (CLAUDE §5).
 */
import { useNavigate, useParams } from 'react-router-dom';
import { Button, PageHeader } from '../../../components/ui';
import { Can } from '../../../auth/Can';
import { SaleDetailView } from '../components/SaleDetailView';

export default function SaleDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader
        title="Sale detail"
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <Button variant="secondary" onClick={() => navigate('/sales')}>
              Back to Sales
            </Button>
            <Can permission="sales:create">
              <Button variant="primary" onClick={() => navigate('/sales/new')}>
                Create New Sale
              </Button>
            </Can>
          </div>
        }
      />
      <SaleDetailView id={id} />
    </div>
  );
}
