/**
 * SaleDetailPage — the deep-linkable `/sales/:id` route. Reads the id from the path and hands it to
 * SaleDetailView (which fetches, gates actions, and handles loading/error/not-found). — SALE-004
 *
 * The header carries NAVIGATION only — "Enter sale" so a rep who has just entered one can immediately
 * enter the next without routing back through the list, plus a way back to the list. The actions that act
 * on THIS sale (validate / greenfield / delete) stay with the record in SaleDetailView. `sales:create` is
 * convenience gating; the server is the real gate (CLAUDE §5).
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
              All sales
            </Button>
            <Can permission="sales:create">
              <Button variant="primary" onClick={() => navigate('/sales/new')}>
                Enter sale
              </Button>
            </Can>
          </div>
        }
      />
      <SaleDetailView id={id} />
    </div>
  );
}
