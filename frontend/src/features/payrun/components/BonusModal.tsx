/**
 * BonusModal — set an ad-hoc bonus on a DRAFT pay-run line (payrun:approve). The amount is an exact-decimal
 * string; the SERVER recomputes the line's net (the UI never does money math, #1/#5). Editable only while
 * the run is a draft; the server is the real gate (§5). Prefills the line's current bonus for editing.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, FormField, Input, Modal, MoneyInput, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { useSetBonus } from '../api/usePayRunMutations';
import styles from './payrun.module.css';
import type { PayRunLine } from '../payrun.types';

const MONEY = /^\d+(\.\d{1,2})?$/;
const schema = z.object({
  amount: z.string().regex(MONEY, 'Enter an amount (max 2 decimals)'),
  note: z.string().max(255).optional(),
});
type Values = z.infer<typeof schema>;

export function BonusModal({ runId, line, onClose }: { runId: string; line: PayRunLine | null; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const setBonus = useSetBonus();
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    values: { amount: line?.bonus_amount ?? '0.00', note: line?.bonus_note ?? '' },
  });

  const onSubmit = (values: Values) => {
    if (!line) return;
    setBonus.mutate(
      { runId, lineId: line.id, body: { amount: values.amount, note: values.note || undefined } },
      { onSuccess: () => { toast({ title: 'Bonus saved', tone: 'success' }); onClose(); }, onError },
    );
  };

  return (
    <Modal open={line !== null} onOpenChange={(o) => !o && onClose()} title={line ? `Bonus · ${line.rep.rep_code}` : 'Bonus'}>
      {line && (
        <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
          <p className={styles.note}>
            Current net for {line.rep.full_name}: <span className="mono">{money(line.net_payout)}</span>. The server recomputes net when you save.
          </p>
          <FormField label="Bonus amount" required error={formState.errors.amount?.message}>
            <MoneyInput {...register('amount')} placeholder="0.00" />
          </FormField>
          <FormField label="Note" help="Optional. The reason for the bonus." error={formState.errors.note?.message}>
            <Input {...register('note')} placeholder="e.g. quarterly spiff" />
          </FormField>
          <div className={styles.footer}>
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={setBonus.isPending}>
              Save bonus
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
