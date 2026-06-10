/**
 * ReleaseSettingSection — the CONFIRMED holdback-release rule (SRS §17.1). The Super Admin picks it ONCE
 * and it's STICKY: a mode (release N pay cycles later, OR release in the first cycle after N days) + N. The
 * Pay Run reads it at finalize to schedule each period's 30% into the correct cycle. A later change applies
 * only to FUTURE holds. Serialised to `cycles:N` / `days:N`; the server is the real gate (`commission:edit`).
 */
import { useEffect, useState } from 'react';
import { Banner, Button, Card, FormField, Input, Select, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useReleaseSetting } from '../api/useCommission';
import { useSetRelease } from '../api/useCommissionMutations';
import styles from './commission.module.css';

type Mode = 'cycles' | 'days';

function parseRule(rule: string | undefined): { mode: Mode; n: number } {
  const m = /^(cycles|days):(\d+)$/.exec((rule ?? '').trim());
  if (m) return { mode: m[1] as Mode, n: Number(m[2]) };
  return { mode: 'days', n: 30 }; // legacy / unset → days:30
}

export function ReleaseSettingSection() {
  const canEdit = useCan('commission:edit');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const q = useReleaseSetting();
  const set = useSetRelease();

  const [mode, setMode] = useState<Mode>('days');
  const [n, setN] = useState('30');

  // Hydrate the form from the saved rule when it loads.
  useEffect(() => {
    const parsed = parseRule(q.data?.release_rule);
    setMode(parsed.mode);
    setN(String(parsed.n));
  }, [q.data?.release_rule]);

  const onSubmit = () => {
    const num = Number.parseInt(n, 10);
    if (!Number.isFinite(num) || num < 1) {
      onError(new Error('Enter a positive number.'));
      return;
    }
    set.mutate(
      { release_rule: `${mode}:${num}` },
      { onSuccess: () => toast({ title: 'Release rule saved', tone: 'success' }), onError },
    );
  };

  const describe = (mode: Mode, num: number) =>
    mode === 'cycles'
      ? `Each period's 30% holdback releases ${num} pay ${num === 1 ? 'cycle' : 'cycles'} later.`
      : `Each period's 30% holdback releases in the first pay cycle at least ${num} days after that period's payday.`;

  return (
    <Card title="Holdback release">
      <DataState isLoading={q.isLoading} isError={q.isError} isEmpty={false} onRetry={() => q.refetch()}>
        <div className={styles.form}>
          <Banner tone="info" title="Sticky setting">
            The Pay Run releases each period's held 30% per this rule. Changing it affects only <strong>future</strong> holds —
            already-scheduled releases are never moved.
          </Banner>
          <div className={styles.grid2}>
            <FormField label="Release mode">
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as Mode)}
                disabled={!canEdit}
                options={[
                  { value: 'days', label: 'In the first cycle after N days' },
                  { value: 'cycles', label: 'N pay cycles later' },
                ]}
              />
            </FormField>
            <FormField label={mode === 'cycles' ? 'Number of cycles (N)' : 'Number of days (N)'}>
              <Input type="number" min={1} value={n} onChange={(e) => setN(e.target.value)} disabled={!canEdit} />
            </FormField>
          </div>
          <p className={styles.note}>{describe(mode, Number.parseInt(n, 10) || 0)}</p>
          {canEdit && (
            <div className={styles.footer}>
              <Button variant="primary" type="button" onClick={onSubmit} loading={set.isPending}>
                Save release rule
              </Button>
            </div>
          )}
        </div>
      </DataState>
    </Card>
  );
}
