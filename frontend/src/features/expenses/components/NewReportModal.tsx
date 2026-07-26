/**
 * NewReportModal — create an expense report FOLDER (report-as-folder, EXP-001). The rep names it; the week
 * defaults to the business week (Mon–Sun) of a picked day (a label only — items keep their own pay period).
 * An admin/manager may create it on behalf of a rep. On success → the folder workspace. Tokens only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, DatePicker, FormField, Input, Modal, Select, useToast } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso, displayDate } from '../../../lib/format/date';
import { useReps } from '../api/useLookups';
import { useCreateReport } from '../api/useExpenseMutations';
import { businessWeek } from '../businessWeek';
import styles from './expenses.module.css';

const SELF = '__self__';

export function NewReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateReport();
  const canSeeReps = useCan('hrm:view');
  const reps = useReps(canSeeReps && open);

  const [anyDay, setAnyDay] = useState(todayIso());
  const week = useMemo(() => businessWeek(anyDay), [anyDay]);
  const [name, setName] = useState('');
  const [repId, setRepId] = useState<string | undefined>();
  const nameEdited = useRef(false);

  // Reset when opened; keep the name in sync with the week until the user customizes it.
  useEffect(() => {
    if (open) {
      setAnyDay(todayIso());
      setName(`Field week of ${businessWeek(todayIso()).week_start}`);
      setRepId(undefined);
      nameEdited.current = false;
    }
  }, [open]);
  useEffect(() => {
    if (open && !nameEdited.current) setName(`Field week of ${week.week_start}`);
  }, [week.week_start, open]);

  const onCreate = () => {
    create.mutate(
      { name: name.trim() || `Field week of ${week.week_start}`, week_start: week.week_start, week_end: week.week_end, rep_id: repId },
      {
        onSuccess: (folder) => {
          // A week is ONE folder per stakeholder, so a second attempt returns the existing one. Say that
          // plainly — reporting "created" while landing the user on a folder that already has items in it
          // is how someone concludes the app made a duplicate.
          toast(
            folder.reused
              ? { title: 'Opened your existing folder for this week', description: 'A week has one folder — your items are all here.', tone: 'info' }
              : { title: 'Report folder created', tone: 'success' },
          );
          onClose();
          navigate(`/expenses/reports/${folder.id}`);
        },
        onError,
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !create.isPending && onClose()}
      title="New expense report"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="button" onClick={onCreate} loading={create.isPending}>
            Create folder
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <FormField label="Name" required>
          <Input
            value={name}
            onChange={(e) => {
              nameEdited.current = true;
              setName(e.target.value);
            }}
            placeholder="e.g. July field expenses"
          />
        </FormField>
        <FormField label="Week" help={`Business week ${displayDate(week.week_start)} – ${displayDate(week.week_end)} (Mon–Sun). A label only — each item pays in the cycle of its own date.`}>
          <DatePicker value={anyDay} onChange={(v) => setAnyDay(v || todayIso())} aria-label="Pick any day in the week" />
        </FormField>
        {canSeeReps && (
          <FormField label="Rep (on behalf of)" help="Defaults to you.">
            <Select
              options={[{ value: SELF, label: 'Myself' }, ...(reps.data ?? []).map((r) => ({ value: r.id, label: `${r.full_name} (${r.rep_code})` }))]}
              value={repId || SELF}
              onValueChange={(v) => setRepId(v === SELF ? undefined : v)}
            />
          </FormField>
        )}
      </div>
    </Modal>
  );
}
