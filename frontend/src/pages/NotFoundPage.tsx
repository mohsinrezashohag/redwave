/**
 * NotFoundPage — the friendly catch-all for any unmatched route inside the app shell, so a mistyped or
 * stale URL never dead-ends on a blank React-Router 404. Offers a link back home. (Known aliases like
 * /users redirect to their real route; this is the genuine "unknown path" fallback.)
 */
import { LayoutDashboard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, PageHeader } from '../components/ui';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', alignItems: 'flex-start' }}>
      <PageHeader title="Page not found" subtitle="That page doesn’t exist or has moved. Check the address, or head back to your dashboard." />
      <Button leftIcon={<LayoutDashboard size={16} />} variant="primary" onClick={() => navigate('/')}>
        Go to dashboard
      </Button>
    </div>
  );
}
