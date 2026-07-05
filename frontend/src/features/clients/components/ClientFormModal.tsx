/**
 * ClientFormModal — create or edit a client (RHF+zod, the playbook). Carries the SA-defined CUSTOM FIELDS
 * (repeatable name/value pairs): when editing, the modal fetches the client DETAIL so the existing fields
 * are loaded before any save (the server replaces the whole set, so we never wipe). Soft-deactivate is a
 * separate row action. A duplicate client_code → 409, surfaced as a toast. Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Trash2 } from 'lucide-react';
import { Button, FormField, IconButton, Input, Modal, Select, Switch, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { useClient } from '../api/useClients';
import { useCreateClient, useUpdateClient } from '../api/useClientMutations';
import type { Client } from '../clients.types';
import styles from './clients.module.css';

export type ClientFormState = { mode: 'create' } | { mode: 'edit'; client: Client } | null;

const schema = z.object({
  client_code: z.string().min(1, 'Required').max(50),
  name: z.string().min(1, 'Required').max(150),
  market: z.enum(['CA', 'US']),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Pick a currency'),
  supplies_mpu_id: z.boolean(),
  custom_fields: z.array(z.object({ field_name: z.string().min(1, 'Name required').max(100), field_value: z.string().max(500) })),
});
type FormValues = z.infer<typeof schema>;

const MARKET_OPTIONS = [
  { value: 'CA', label: 'Canada (CA)' },
  { value: 'US', label: 'United States (US)' },
];

export function ClientFormModal({ state, onClose }: { state: ClientFormState; onClose: () => void }) {
  const open = state !== null;
  const editingId = state?.mode === 'edit' ? state.client.id : undefined;
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateClient();
  const update = useUpdateClient();
  const currencies = useCurrencies();
  // When editing, load the DETAIL so existing custom_fields are present before a save (avoids wiping them).
  const detail = useClient(editingId);
  const editing = state?.mode === 'edit' ? detail.data ?? state.client : null;
  const fieldsLoaded = !editingId || detail.isSuccess;

  // Always include CAD (the base) + the client's PERSISTED currency, so a USD client's value still renders
  // even while the catalogue is loading or if the fetch fails — never collapse to a CAD-only list (H1).
  const currencyOptions = (() => {
    const opts = new Map<string, string>([['CAD', 'CAD · Canadian Dollar']]);
    for (const c of currencies.data ?? []) opts.set(c.code, `${c.code} · ${c.name}`);
    if (editing?.currency && !opts.has(editing.currency)) opts.set(editing.currency, editing.currency);
    return [...opts].map(([value, label]) => ({ value, label }));
  })();

  const { control, register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      client_code: editing?.client_code ?? '',
      name: editing?.name ?? '',
      market: editing?.market ?? 'CA',
      currency: editing?.currency ?? 'CAD',
      supplies_mpu_id: editing?.supplies_mpu_id ?? false,
      custom_fields: (editing?.custom_fields ?? []).map((f) => ({ field_name: f.field_name, field_value: f.field_value })),
    },
  });
  const errors = formState.errors;
  const customFields = useFieldArray({ control, name: 'custom_fields' });

  const onSubmit = (values: FormValues) => {
    if (state?.mode === 'edit') {
      update.mutate(
        { id: state.client.id, body: values },
        { onSuccess: () => { toast({ title: 'Client updated', tone: 'success' }); onClose(); }, onError },
      );
    } else {
      create.mutate(values, {
        onSuccess: (c) => { toast({ title: 'Client created', description: c.client_code, tone: 'success' }); onClose(); },
        onError,
      });
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={state?.mode === 'edit' ? 'Edit client' : 'Create client'}>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Client code" required error={errors.client_code?.message} help="Unique — never reused.">
          <Input {...register('client_code')} placeholder="VF" />
        </FormField>
        <FormField label="Name" required error={errors.name?.message}>
          <Input {...register('name')} placeholder="Valley Fiber" />
        </FormField>
        <Controller
          control={control}
          name="market"
          render={({ field }) => (
            <FormField label="Market" required error={errors.market?.message}>
              <Select options={MARKET_OPTIONS} value={field.value} onValueChange={field.onChange} />
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="currency"
          render={({ field }) => (
            <FormField
              label="Billing currency"
              required
              error={errors.currency?.message}
              help="All this client's billing rates + documents are in it; rolls up to CAD. Locks once a statement/invoice is issued."
            >
              <Select options={currencyOptions} value={field.value} onValueChange={field.onChange} disabled={currencies.isLoading} />
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="supplies_mpu_id"
          render={({ field }) => (
            <Switch label="Supplies per-house MPU IDs" checked={field.value} onCheckedChange={field.onChange} />
          )}
        />

        <FormField label="Custom fields" help="Optional name/value pairs carrying extra info about this client.">
          <div className={styles.customFieldsList}>
            {customFields.fields.map((f, i) => (
              <div key={f.id} className={styles.customFieldRow}>
                <Input {...register(`custom_fields.${i}.field_name`)} placeholder="Field name" aria-label="Field name" />
                <Input {...register(`custom_fields.${i}.field_value`)} placeholder="Value" aria-label="Field value" />
                <IconButton label="Remove field" icon={<Trash2 size={16} />} variant="ghost" onClick={() => customFields.remove(i)} />
              </div>
            ))}
            <div>
              <Button type="button" variant="tertiary" size="sm" onClick={() => customFields.append({ field_name: '', field_value: '' })}>
                Add field
              </Button>
            </div>
          </div>
        </FormField>

        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!fieldsLoaded} loading={create.isPending || update.isPending}>
            {state?.mode === 'edit' ? 'Save changes' : 'Create client'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
