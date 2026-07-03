/**
 * KmRateModal — add a future-dated km rate for a (stream, client) scope (#10 supersession; back-date → 422).
 * Stream = rep (reimbursement, drives the km amount) or client_bill (Wave-2 client expense doc); the two
 * are never combined (#3). Client = All (global default) or a specific client. Rate is a $/km decimal (≤3dp).
 * The server is the real gate; this mirrors its rules. Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Banner, Button, DatePicker, FormField, Input, Modal, Select, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useClients } from '../../expenses/api/useLookups';
import { useCan } from '../../../auth/useCan';
import { useCreateKmRate } from '../api/useKmRates';
import styles from './kmRates.module.css';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RATE = /^\d+(\.\d{1,3})?$/;
const ALL = '__all__';

const schema = z.object({
  stream: z.enum(['rep', 'client_bill']),
  client_id: z.string(),
  rate_per_km: z.string().regex(RATE, 'Enter a rate (≤3 dp)'),
  effective_from: z.string().regex(DATE, 'Date required').refine((d) => d >= todayIso(), 'Must be today or later'),
  effective_to: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function KmRateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateKmRate();
  const canViewClients = useCan('clients:view');
  const clients = useClients(canViewClients);

  const { control, register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { stream: 'rep', client_id: ALL, rate_per_km: '', effective_from: '', effective_to: '' },
  });
  const errors = formState.errors;

  const onSubmit = (values: FormValues) => {
    create.mutate(
      {
        stream: values.stream,
        client_id: values.client_id === ALL ? undefined : values.client_id,
        rate_per_km: values.rate_per_km,
        effective_from: values.effective_from,
        effective_to: values.effective_to || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: 'KM rate added', tone: 'success' });
          onClose();
        },
        onError,
      },
    );
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Add km rate">
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Banner tone="info" title="Effective-dated">
          A future-dated rate supersedes the pending one for this stream + client and bounds the current.
          Back-dating is rejected. Omit the client for the global default.
        </Banner>

        <div className={styles.row}>
          <Controller
            control={control}
            name="stream"
            render={({ field }) => (
              <FormField label="Stream" required help="Rep drives reimbursement; client-bill is charged to the client (#3).">
                <Select
                  options={[
                    { value: 'rep', label: 'Rep (reimbursement)' },
                    { value: 'client_bill', label: 'Client bill' },
                  ]}
                  value={field.value}
                  onValueChange={field.onChange}
                />
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="client_id"
            render={({ field }) => (
              <FormField label="Client" help={canViewClients ? 'All = global default.' : 'Global default (clients:view needed to scope).'}>
                <Select
                  options={[
                    { value: ALL, label: 'All clients (global)' },
                    ...(clients.data ?? []).map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  value={field.value}
                  onValueChange={field.onChange}
                />
              </FormField>
            )}
          />
        </div>

        <FormField label="Rate ($/km)" required error={errors.rate_per_km?.message}>
          <Input {...register('rate_per_km')} placeholder="0.450" inputMode="decimal" className="mono" />
        </FormField>

        <div className={styles.row}>
          <Controller
            control={control}
            name="effective_from"
            render={({ field }) => (
              <FormField label="Effective from" required error={errors.effective_from?.message}>
                <DatePicker value={field.value} onChange={field.onChange} min={todayIso()} invalid={!!errors.effective_from} aria-label="Effective from" />
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="effective_to"
            render={({ field }) => (
              <FormField label="Effective to" help="Open-ended if left blank.">
                <DatePicker value={field.value ?? ''} onChange={field.onChange} min={todayIso()} aria-label="Effective to" />
              </FormField>
            )}
          />
        </div>

        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={create.isPending}>
            Add rate
          </Button>
        </div>
      </form>
    </Modal>
  );
}
