/**
 * AccessDenied — the graceful state when the SERVER returns 403 for a dashboard the caller can't see
 * (the real gate, CLAUDE §5). The UI normally hides such links, but if one is reached directly the page
 * renders this instead of breaking, with a way back to the user's own landing.
 */
import { Banner, Button } from '../../../components/ui';
import { useNavigate } from 'react-router-dom';

export function AccessDenied({ message, title = "You don’t have access to this page" }: { message?: string; title?: string }) {
  const navigate = useNavigate();
  return (
    <Banner tone="warning" title={title}>
      {message ?? 'Your role doesn’t permit this view. The server enforces access regardless of navigation.'}
      <div style={{ marginTop: 'var(--space-3)' }}>
        <Button variant="secondary" onClick={() => navigate('/')}>
          Go to my dashboard
        </Button>
      </div>
    </Banner>
  );
}
