/**
 * MyRepProfileSection — the signed-in rep's OWN rep profile on My Account (client request 2026-11-11).
 *
 * Read-only by design. Who controls what:
 *   - The rep may REQUEST a change to name, phone, contact email, address and uniform sizes (the form above
 *     this section; a reviewer approves before anything applies).
 *   - Rep code, status, dates, field manager, date of birth, SIN, equipment and documents are managed by HR;
 *     the rep sees them here and can open their own documents, nothing more.
 * Everything is fetched from token-scoped endpoints (/v1/account/rep-profile*) — no rep id is ever sent.
 */
import { Card } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useMyRepProfile } from '../api/useRepProfile';
import { RepProfileCard } from './RepProfileCard';
import { RepEquipmentPanel } from './RepEquipmentPanel';
import { RepDocumentsPanel } from './RepDocumentsPanel';
import { RepHeadshot } from './RepHeadshot';
import styles from './reps.module.css';

export function MyRepProfileSection() {
  const q = useMyRepProfile();
  const rep = q.data;
  return (
    <DataState isLoading={q.isLoading} isError={q.isError} isEmpty={false} onRetry={() => q.refetch()}>
      {rep && (
        <div className={styles.page}>
          <div className={styles.detailHead}>
            <RepHeadshot repId={rep.id} name={rep.full_name} self canOpen />
            <span className={styles.code}>{rep.rep_code}</span>
          </div>
          <p className={styles.muted}>
            Your rep code, status, dates, field manager, date of birth, SIN, equipment and documents are managed by
            HR. Contact HR if any of these is wrong.
          </p>
          <RepProfileCard rep={rep} self managerName={rep.field_manager_name} />
          <Card title="Equipment">
            <RepEquipmentPanel repId={rep.id} self />
          </Card>
          <Card title="Documents">
            <RepDocumentsPanel repId={rep.id} self />
          </Card>
        </div>
      )}
    </DataState>
  );
}
