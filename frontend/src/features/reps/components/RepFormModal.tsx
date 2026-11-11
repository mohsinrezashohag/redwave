/**
 * RepFormModal — Add / Edit a rep, including the profile Redwave asked for (2026-11-11): date of birth,
 * contact, address, SIN, jacket + t-shirt size. RHF + zod (§13.2); the rules mirror the server's and the
 * server re-validates (422).
 *
 * SIN is WRITE-ONLY here: the form never holds the stored value. On edit it shows what is on file
 * (masked) and a blank field keeps it; typing a new one replaces it. Viewing it is the profile's audited
 * Reveal, not this form. rep_code is set once at create and never editable (#11). Tokens only.
 */
import { useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Button, DatePicker, FormField, Input, Modal, PrivateInput, Select, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useCan } from '../../../auth/useCan';
import { useUsers } from '../../admin/api/useUsers';
import { useCreateRep, useUpdateRep } from '../api/useRepProfile';
import { CLOTHING_SIZES, NONE, PROVINCES, repFormDefaults, repFormSchema, toCreateBody, toUpdateBody, type RepFormValues } from '../repForm';
import type { Rep } from '../reps.types';
import styles from './reps.module.css';

export type RepFormState = { mode: 'create' } | { mode: 'edit'; rep: Rep } | null;

const SIZE_OPTIONS = [{ value: NONE, label: 'Not set' }, ...CLOTHING_SIZES.map((s) => ({ value: s, label: s }))];
const PROVINCE_OPTIONS = [{ value: NONE, label: 'Not set' }, ...PROVINCES.map((p) => ({ value: p, label: p }))];
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'terminated', label: 'Terminated' },
];

export function RepFormModal({ state, onClose, onSaved }: { state: RepFormState; onClose: () => void; onSaved?: (rep: Rep) => void }) {
  const open = state !== null;
  const mode = state?.mode ?? 'create';
  const editing = state?.mode === 'edit' ? state.rep : null;
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateRep();
  const update = useUpdateRep();
  const canViewUsers = useCan('users:view');
  const users = useUsers(open && canViewUsers);

  const managerOptions = useMemo(() => {
    const opts = (users.data ?? [])
      .filter((u) => u.status === 'active' && u.user_roles.some((r) => r.role.name === 'Manager'))
      .map((u) => ({ value: u.id, label: u.full_name }));
    // Keep the rep's current manager selectable even if the user list is unavailable.
    if (editing && !opts.some((o) => o.value === editing.field_manager_id)) {
      opts.unshift({ value: editing.field_manager_id, label: 'Current manager' });
    }
    return opts;
  }, [users.data, editing]);

  const today = todayIso();
  const { control, register, handleSubmit, formState } = useForm<RepFormValues>({
    resolver: zodResolver(repFormSchema(mode, today)),
    values: repFormDefaults(editing),
  });
  const errors = formState.errors;
  const status = useWatch({ control, name: 'status' });

  const onSubmit = (values: RepFormValues) => {
    const done = (rep: Rep, title: string) => {
      toast({ title, description: rep.rep_code, tone: 'success' });
      onSaved?.(rep);
      onClose();
    };
    if (editing) {
      update.mutate({ id: editing.id, body: toUpdateBody(values) }, { onSuccess: (r) => done(r, 'Rep updated'), onError });
    } else {
      create.mutate(toCreateBody(values), { onSuccess: (r) => done(r, 'Rep created'), onError });
    }
  };

  const date = (name: 'hire_date' | 'termination_date' | 'date_of_birth', label: string, required = false, max?: string) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FormField label={label} required={required} error={errors[name]?.message}>
          <DatePicker value={field.value} onChange={field.onChange} max={max} clearable={!required} invalid={!!errors[name]} aria-label={label} />
        </FormField>
      )}
    />
  );

  const select = (name: 'field_manager_id' | 'status' | 'address_province' | 'jacket_size' | 'tshirt_size', label: string, options: { value: string; label: string }[], required = false) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FormField label={label} required={required} error={errors[name]?.message}>
          <Select options={options} value={field.value || undefined} onValueChange={field.onChange} placeholder="Select…" autoComplete="off" aria-label={label} />
        </FormField>
      )}
    />
  );

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={editing ? `Edit ${editing.full_name}` : 'Add rep'} size="lg">
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Rep</h3>
          <div className={styles.grid2}>
            {editing ? (
              <FormField label="Rep code" help="Permanent — never changed or reused.">
                <Input value={editing.rep_code} readOnly className="mono" />
              </FormField>
            ) : (
              <FormField label="Rep code" required error={errors.rep_code?.message} help="Permanent — never changed or reused.">
                <Input {...register('rep_code')} placeholder="RW-0100" className="mono" />
              </FormField>
            )}
            <FormField label="Partner code" error={errors.external_code?.message} help="Optional, e.g. Redwave20.">
              <Input {...register('external_code')} placeholder="Redwave20" />
            </FormField>
            <FormField label="Full name" required error={errors.full_name?.message}>
              <PrivateInput {...register('full_name')} placeholder="Jordan Field" />
            </FormField>
            {select('field_manager_id', 'Field manager', managerOptions, true)}
            {date('hire_date', 'Hire date', true)}
            {editing && select('status', 'Status', STATUS_OPTIONS, true)}
            {editing && status === 'terminated' && date('termination_date', 'Termination date', true)}
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Personal</h3>
          <div className={styles.grid2}>
            {date('date_of_birth', 'Date of birth', false, today)}
            <FormField label="Phone" error={errors.phone?.message}>
              <PrivateInput {...register('phone')} inputMode="tel" placeholder="204 555 0142" />
            </FormField>
            <FormField label="Email" error={errors.email?.message}>
              <PrivateInput {...register('email')} type="email" placeholder="jordan@example.com" />
            </FormField>
            <FormField
              label="SIN"
              error={errors.sin?.message}
              help={
                editing?.sin_on_file
                  ? `On file (${editing.sin_masked ?? 'hidden'}). Leave blank to keep it, or type a new one to replace it.`
                  : '9 digits, as printed on the rep’s SIN card (spaces or dashes are fine). It’s checked for typos, saved encrypted, and only HR can reveal it.'
              }
            >
              <PrivateInput {...register('sin')} inputMode="numeric" placeholder="123 456 789" className="mono" />
            </FormField>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Address</h3>
          <div className={styles.grid2}>
            <FormField label="Street" error={errors.address_street?.message}>
              <PrivateInput {...register('address_street')} placeholder="1250 Portage Ave" />
            </FormField>
            <FormField label="City" error={errors.address_city?.message}>
              <PrivateInput {...register('address_city')} placeholder="Winnipeg" />
            </FormField>
            {select('address_province', 'Province', PROVINCE_OPTIONS)}
            <FormField label="Postal code" error={errors.address_postal?.message}>
              <PrivateInput {...register('address_postal')} placeholder="R3G 0T7" className="mono" />
            </FormField>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Uniform</h3>
          <div className={styles.grid2}>
            {select('jacket_size', 'Jacket size', SIZE_OPTIONS)}
            {select('tshirt_size', 'T-shirt size', SIZE_OPTIONS)}
          </div>
        </section>

        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={create.isPending || update.isPending}>
            {editing ? 'Save changes' : 'Add rep'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
