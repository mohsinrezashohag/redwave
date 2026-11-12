/**
 * RecordNotFound — the state for a detail page whose record doesn't exist (a 404: a mistyped or old link,
 * or a record that was removed). A Retry can never fix that, so this explains it and offers the way back
 * to the list instead. — 2026-11-12
 */
import { useNavigate } from 'react-router-dom';
import { Banner, Button } from '../ui';

export function RecordNotFound({ what, backTo, backLabel }: { what: string; backTo: string; backLabel: string }) {
  const navigate = useNavigate();
  return (
    <Banner tone="warning" title={`This ${what} wasn’t found`}>
      The link may be out of date, or the {what} was removed.
      <div style={{ marginTop: 'var(--space-3)' }}>
        <Button variant="secondary" onClick={() => navigate(backTo)}>
          {backLabel}
        </Button>
      </div>
    </Banner>
  );
}
