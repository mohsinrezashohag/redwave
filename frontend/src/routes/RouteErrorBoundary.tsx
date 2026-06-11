/**
 * RouteErrorBoundary — the router-level `errorElement`. A render error in any route (e.g. the list-page
 * `{data,meta}` crash) bubbles here and shows the design-system friendly panel with a retry, instead of
 * React Router's raw "Unexpected Application Error!" white screen. Wired in routes/router.tsx onto the
 * pathless layout inside AppShell (so the panel renders WITHIN the shell) + the RequireAuth backstop. The
 * technical error is logged for developers; the user sees a calm, actionable message. — CLAUDE §13
 */
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';
import { Banner, Button } from '../components/ui';

export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  // Keep the technical detail in the console for debugging; never surface a raw stack to the user.
  console.error('Route error boundary caught an error:', error);

  const isResponse = isRouteErrorResponse(error);
  const notFound = isResponse && error.status === 404;
  const title = notFound ? 'Page not found' : 'Something went wrong on this page';
  const message = notFound
    ? "That page doesn't exist or has moved."
    : isResponse
      ? error.statusText || `The request failed (${error.status}).`
      : 'An unexpected error occurred while loading this page. You can try again, or head back to your dashboard.';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-5)',
        alignItems: 'flex-start',
        maxWidth: '42rem',
      }}
    >
      <Banner tone="danger" title={title}>
        {message}
      </Banner>
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Try again
        </Button>
        <Button variant="secondary" onClick={() => navigate('/')}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
