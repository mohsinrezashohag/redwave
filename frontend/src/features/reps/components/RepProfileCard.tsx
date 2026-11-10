/**
 * RepProfileCard — the rep's profile as read-only label/value pairs (client request 2026-11-11).
 *
 * PII arrives already redacted for callers without hrm:edit (server-side, HRM-008), so those fields show a
 * "restricted" note rather than an empty dash — "you may not see this" is not "nothing on file". The SIN shows
 * masked; Reveal (hrm:edit) calls the audited endpoint and hides it again after 30 s. Tokens only.
 */
import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Card, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCan } from '../../../auth/useCan';
import { displayDate } from '../../../lib/format/date';
import { useRevealSin } from '../api/useRepProfile';
import type { Rep } from '../reps.types';
import styles from './reps.module.css';

const REVEAL_MS = 30_000;

export function RepProfileCard({ rep }: { rep: Rep }) {
  const canSeePii = useCan('hrm:edit');
  const restricted = <span className={styles.muted}>Restricted</span>;
  const val = (v: string | null | undefined) => (canSeePii ? v || '—' : restricted);
  const address = [rep.address_street, rep.address_city, rep.address_province, rep.address_postal].filter(Boolean).join(', ');

  return (
    <div className={styles.cards}>
      <Card title="Personal">
        <dl className={styles.dl}>
          <dt>Date of birth</dt>
          <dd className="mono">{canSeePii ? (rep.date_of_birth ? displayDate(rep.date_of_birth) : '—') : restricted}</dd>
          <dt>Phone</dt>
          <dd>{val(rep.phone)}</dd>
          <dt>Email</dt>
          <dd>{val(rep.email)}</dd>
          <dt>Address</dt>
          <dd>{val(address)}</dd>
          <dt>SIN</dt>
          <dd>
            <SinValue rep={rep} canReveal={canSeePii} />
          </dd>
        </dl>
      </Card>
      <Card title="Uniform">
        <dl className={styles.dl}>
          <dt>Jacket size</dt>
          <dd>{rep.jacket_size ?? '—'}</dd>
          <dt>T-shirt size</dt>
          <dd>{rep.tshirt_size ?? '—'}</dd>
        </dl>
      </Card>
      <Card title="Employment">
        <dl className={styles.dl}>
          <dt>Hire date</dt>
          <dd className="mono">{displayDate(rep.hire_date)}</dd>
          {rep.termination_date && (
            <>
              <dt>Terminated</dt>
              <dd className="mono">{displayDate(rep.termination_date)}</dd>
            </>
          )}
          <dt>Partner code</dt>
          <dd className="mono">{rep.external_code ?? '—'}</dd>
          <dt>Login linked</dt>
          <dd>{rep.user_id ? 'Yes' : 'No'}</dd>
        </dl>
      </Card>
    </div>
  );
}

function SinValue({ rep, canReveal }: { rep: Rep; canReveal: boolean }) {
  const reveal = useRevealSin();
  const onError = useApiErrorToast();
  const { toast } = useToast();
  const [shown, setShown] = useState<string | null>(null);

  // Never leave a SIN on screen: hide it again after a short while, and when the rep changes.
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), REVEAL_MS);
    return () => clearTimeout(t);
  }, [shown]);
  useEffect(() => setShown(null), [rep.id]);

  if (!rep.sin_on_file) return <>—</>;
  if (!canReveal) return <span className={styles.muted}>On file · restricted</span>;

  return (
    <span className={styles.sinRow}>
      <span className="mono">{shown ?? rep.sin_masked}</span>
      {shown ? (
        <Button variant="tertiary" size="sm" type="button" leftIcon={<EyeOff size={14} />} onClick={() => setShown(null)}>
          Hide
        </Button>
      ) : (
        <Button
          variant="tertiary"
          size="sm"
          type="button"
          leftIcon={<Eye size={14} />}
          loading={reveal.isPending}
          onClick={() =>
            reveal.mutate(rep.id, {
              onSuccess: (r) => {
                setShown(r.sin);
                toast({ title: 'SIN revealed', description: 'This view has been recorded in the audit log.', tone: 'info' });
              },
              onError,
            })
          }
        >
          Reveal
        </Button>
      )}
    </span>
  );
}
