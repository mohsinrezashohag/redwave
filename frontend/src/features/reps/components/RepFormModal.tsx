/**
 * RepFormModal — Add / Edit a rep, including the profile Redwave asked for (2026-11-11): date of birth,
 * contact, address, SIN, jacket + t-shirt size. RHF + zod (§13.2); the rules mirror the server's and the
 * server re-validates (422).
 *
 * SIN is WRITE-ONLY here: the form never holds the stored value. On edit it shows what is on file
 * (masked) and a blank field keeps it; typing a new one replaces it. Viewing it is the profile's audited
 * Reveal, not this form. rep_code is set once at create and never editable (#11). Tokens only.
 *
 * PHOTO (2026-11-12): click the photo (pen on hover) to pick one, crop / zoom / rotate it, and see it in the
 * circle straight away. "Edit photo" reopens the editor; nothing is uploaded until Save, when it becomes the
 * rep's new headshot.
 */
import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Crop, Undo2 } from 'lucide-react';
import { Button, DatePicker, EditableAvatar, FormField, Input, Modal, PhotoEditorDialog, PrivateInput, Select, useToast, type PhotoEditResult, ModalClose } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { useCan } from '../../../auth/useCan';
import { useUsers } from '../../admin/api/useUsers';
import { useCreateRep, useRepHeadshotUrl, useUpdateRep, useUploadHeadshot } from '../api/useRepProfile';
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
  const uploadPhoto = useUploadHeadshot();
  const currentPhoto = useRepHeadshotUrl(editing?.id, { canOpen: open && !!editing });
  // A picked + edited photo waiting for Save, with its preview URL and what's needed to re-edit it.
  const [photo, setPhoto] = useState<(PhotoEditResult & { preview: string }) | null>(null);
  const [reEditing, setReEditing] = useState(false);
  const setPending = (next: PhotoEditResult | null) =>
    setPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return next ? { ...next, preview: URL.createObjectURL(next.file) } : null;
    });
  // A fresh form never inherits the last rep's unsaved photo.
  useEffect(() => {
    setPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return null;
    });
    setReEditing(false);
  }, [state]);
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
  const formDefaults: RepFormValues = repFormDefaults(editing);
  const { control, register, handleSubmit, formState, reset } = useForm<RepFormValues>({
    resolver: zodResolver(repFormSchema(mode, today, !!editing?.banking?.account_masked)),
    values: formDefaults,
  });
  // Reopening starts fresh: nothing typed last time is left in the form. 2026-11-12
  useEffect(() => {
    if (open) reset(formDefaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the dialog (re)opens; defaults are read then
  }, [open]);
  const errors = formState.errors;
  const status = useWatch({ control, name: 'status' });

  const onSubmit = (values: RepFormValues) => {
    const done = async (rep: Rep, title: string) => {
      // The photo is uploaded once the rep exists (a new rep has no id until now).
      if (photo) {
        try {
          await uploadPhoto.mutateAsync({ repId: rep.id, file: photo.file });
        } catch (e) {
          onError(e);
          toast({ title: `${title}, but the photo didn’t upload`, description: 'Use the pen on the profile photo to try again.', tone: 'warning' });
          onSaved?.(rep);
          onClose();
          return;
        }
      }
      toast({ title, description: rep.rep_code, tone: 'success' });
      onSaved?.(rep);
      onClose();
    };
    if (editing) {
      update.mutate({ id: editing.id, body: toUpdateBody(values, !!editing?.banking) }, { onSuccess: (r) => void done(r, 'Rep updated'), onError });
    } else {
      create.mutate(toCreateBody(values), { onSuccess: (r) => void done(r, 'Rep created'), onError });
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
    <Modal dirty={formState.isDirty || !!photo} open={open} onOpenChange={(o) => !o && onClose()} title={editing ? `Edit ${editing.full_name}` : 'Add rep'} size="lg">
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className={styles.photoRow}>
          <EditableAvatar
            name={editing?.full_name || 'New rep'}
            src={photo?.preview ?? currentPhoto}
            onChange={(r) => setPending(r)}
          />
          <div className={styles.photoText}>
            <span className={styles.photoTitle}>Photo</span>
            <span className={styles.muted}>
              {photo ? 'New photo selected. It is saved with the rest of the profile.' : 'Click the photo to upload one (JPG or PNG). It is also used for the ID card.'}
            </span>
            {photo && (
              <span className={styles.photoActions}>
                <Button variant="tertiary" size="sm" type="button" leftIcon={<Crop size={14} />} onClick={() => setReEditing(true)}>
                  Edit photo
                </Button>
                <Button variant="tertiary" size="sm" type="button" leftIcon={<Undo2 size={14} />} onClick={() => setPending(null)}>
                  Undo
                </Button>
              </span>
            )}
          </div>
        </div>
        <PhotoEditorDialog
          source={reEditing && photo ? photo.source : null}
          initialCrop={photo?.crop}
          onCancel={() => setReEditing(false)}
          onSave={(r) => {
            setPending(r);
            setReEditing(false);
          }}
        />

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Rep</h3>
          <div className={styles.grid2}>
            {editing ? (
              <FormField label="Rep code" help="Permanent. Never changed or reused.">
                <Input value={editing.rep_code} readOnly className="mono" />
              </FormField>
            ) : (
              <FormField label="Rep code" required error={errors.rep_code?.message} help="Permanent. Never changed or reused.">
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
          <h3 className={styles.sectionTitle}>Banking</h3>
          <div className={styles.grid2}>
            <FormField label="Institution no." error={errors.bank_institution?.message} help="3 digits, e.g. 001">
              <PrivateInput {...register('bank_institution')} inputMode="numeric" placeholder="001" className="mono" />
            </FormField>
            <FormField label="Transit no." error={errors.bank_transit?.message} help="5 digits, e.g. 12345">
              <PrivateInput {...register('bank_transit')} inputMode="numeric" placeholder="12345" className="mono" />
            </FormField>
            <FormField
              label="Account no."
              error={errors.bank_account?.message}
              help={
                editing?.banking?.account_masked
                  ? `On file (${editing.banking.account_masked}). Leave blank to keep it, or type a new one to replace it.`
                  : '7 to 12 digits. Saved encrypted; only HR can reveal it. Upload the void cheque under Documents.'
              }
            >
              <PrivateInput {...register('bank_account')} inputMode="numeric" placeholder="1234567" className="mono" />
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
          <ModalClose asChild>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </ModalClose>
          <Button variant="primary" type="submit" loading={create.isPending || update.isPending || uploadPhoto.isPending}>
            {editing ? 'Save changes' : 'Add rep'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
