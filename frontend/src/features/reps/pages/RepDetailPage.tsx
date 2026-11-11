/**
 * RepDetailPage — /admin/reps/:id. One rep's full record (SRS HRM-001/005/006, client request 2026-11-11):
 * Profile (personal · uniform · employment) · Equipment (iPad etc. + deposits) · Documents. Deep-linkable
 * detail route (§13.2), never a drawer. hrm:view to see; Edit is hrm:edit. 403 → AccessDenied, 404 → a
 * graceful not-found. PII is redacted server-side for callers without hrm:edit. Tokens only.
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, PageHeader, Tabs } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden, isNotFound } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useRep } from '../api/useRepProfile';
import { RepProfileCard } from '../components/RepProfileCard';
import { RepEquipmentPanel } from '../components/RepEquipmentPanel';
import { RepDocumentsPanel } from '../components/RepDocumentsPanel';
import { RepFormModal, type RepFormState } from '../components/RepFormModal';
import { EditableRepHeadshot, RepHeadshot } from '../components/RepHeadshot';
import styles from '../components/reps.module.css';

export default function RepDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canView = useCan('hrm:view');
  const canEdit = useCan('hrm:edit');
  const rep = useRep(canView ? id : undefined);
  const [form, setForm] = useState<RepFormState>(null);

  if (!canView || isForbidden(rep.error)) {
    return <AccessDenied message="Viewing reps requires the HRM view permission." />;
  }
  if (isNotFound(rep.error)) {
    return <AccessDenied message="This rep doesn’t exist, or was removed." />;
  }

  const r = rep.data;
  return (
    <div className={styles.page}>
      <PageHeader
        title={r?.full_name ?? 'Rep'}
        actions={
          r && canEdit ? (
            <Button variant="secondary" onClick={() => setForm({ mode: 'edit', rep: r })}>
              Edit profile
            </Button>
          ) : undefined
        }
      />
      <DataState isLoading={rep.isLoading} isError={rep.isError} isEmpty={false} onRetry={() => rep.refetch()}>
        {r && (
          <>
            <div className={styles.detailHead}>
              {canEdit ? (
                <EditableRepHeadshot repId={r.id} name={r.full_name} />
              ) : (
                <RepHeadshot repId={r.id} name={r.full_name} canOpen={false} />
              )}
              <span className={styles.code}>{r.rep_code}</span>
              <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status === 'active' ? 'Active' : 'Terminated'}</Badge>
            </div>
            <Tabs
              ariaLabel="Rep sections"
              items={[
                { value: 'profile', label: 'Profile', content: <RepProfileCard rep={r} /> },
                { value: 'equipment', label: 'Equipment', content: <RepEquipmentPanel repId={r.id} /> },
                { value: 'documents', label: 'Documents', content: <RepDocumentsPanel repId={r.id} /> },
              ]}
            />
          </>
        )}
      </DataState>
      <RepFormModal state={form} onClose={() => setForm(null)} onSaved={() => void rep.refetch()} />
    </div>
  );
}
