/**
 * PendingChangeBanner — makes the edit-as-request rule explicit on My Account: when a profile change is
 * awaiting review, the live profile is UNCHANGED and this banner shows exactly what was proposed and that
 * it is not yet applied (SRS AUTH-011, design-system §10.6). Tokens only.
 */
import { Banner } from '../../../components/ui';
import { displayDate } from '../../../lib/format/date';
import { profileFieldLabel, profileFieldValue } from '../../../lib/format/profileFields';
import type { PendingRequestSummary } from '../account.types';
import styles from './account.module.css';

export function PendingChangeBanner({ request }: { request: PendingRequestSummary }) {
  const entries = Object.entries(request.proposed_changes).filter(([, v]) => v !== undefined && v !== null);
  return (
    <Banner tone="info" title="Profile change pending review">
      You submitted these changes. They are awaiting a reviewer and are <strong>not applied yet</strong>:
      <ul className={styles.pendingList}>
        {entries.map(([key, value]) => (
          <li key={key} className={styles.pendingItem}>
            {profileFieldLabel(key)}: <span className={styles.pendingTo}>{profileFieldValue(key, value)}</span>
          </li>
        ))}
      </ul>
      <span className={styles.help}>Submitted {displayDate(request.created_at)}.</span>
    </Banner>
  );
}
