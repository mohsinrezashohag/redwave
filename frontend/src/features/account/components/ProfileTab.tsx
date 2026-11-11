/**
 * ProfileTab — view the profile + edit HR fields AS A REQUEST (never a live write — SRS AUTH-011). On save
 * the changed fields POST a profile_change_request (pending); the live profile is unchanged and a pending
 * banner appears until a reviewer approves. While a change is pending the form is disabled (one request at
 * a time). Reuses the playbook: TanStack Query + RHF+zod + FormField + DataState + toast. Tokens only.
 *
 * A signed-in REP additionally (client request 2026-11-11):
 *   - may request contact email, address and jacket / t-shirt size (applied to their REP record on approval);
 *   - sees the rest of their rep profile read-only below — rep code, status, dates, manager, DOB, masked SIN,
 *     equipment and their documents — which HR manages (MyRepProfileSection).
 */
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Avatar, Badge, Button, FormField, Input, Select, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useAuth } from '../../../auth/useAuth';
import { useAccountProfile } from '../api/useAccount';
import { useRequestProfileChange } from '../api/useAccountMutations';
import { useMyRepProfile } from '../../reps/api/useRepProfile';
import { MyRepProfileSection } from '../../reps/components/MyRepProfileSection';
import { CLOTHING_SIZES, NONE, PROVINCES } from '../../reps/repForm';
import type { MyRepProfile } from '../../reps/reps.types';
import { PendingChangeBanner } from './PendingChangeBanner';
import { PhotoPicker, type PhotoChange } from './PhotoPicker';
import type { AccountProfile, ProfileChangeRequestBody } from '../account.types';
import styles from './account.module.css';

const POSTAL = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

const schema = z.object({
  full_name: z.string().min(1, 'Required').max(150),
  phone: z.string().max(50).optional(),
  // Rep-only (shown only to a rep).
  email: z.string().refine((v) => !v || z.string().email().safeParse(v).success, 'Enter a valid email'),
  address_street: z.string().max(200),
  address_city: z.string().max(100),
  address_province: z.string(),
  address_postal: z.string().refine((v) => !v || POSTAL.test(v.trim()), 'Use a Canadian postal code, e.g. R3G 0T7'),
  jacket_size: z.string(),
  tshirt_size: z.string(),
});
type FormValues = z.infer<typeof schema>;

const SIZE_OPTIONS = [{ value: NONE, label: 'Not set' }, ...CLOTHING_SIZES.map((s) => ({ value: s, label: s }))];
const PROVINCE_OPTIONS = [{ value: NONE, label: 'Not set' }, ...PROVINCES.map((p) => ({ value: p, label: p }))];

/** Rep fields a rep may request; a cleared value is not sent (clearing is HR's call). */
const REP_TEXT = ['email', 'address_street', 'address_city', 'address_postal'] as const;
const REP_PICK = ['address_province', 'jacket_size', 'tshirt_size'] as const;

function ProfileEditForm({ profile, rep }: { profile: AccountProfile; rep: MyRepProfile | null }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const req = useRequestProfileChange();
  // The photo is uploaded, not typed (2026-11-12): a new storage path, '' to remove, or undefined = unchanged.
  const [photo, setPhoto] = useState<PhotoChange>(undefined);

  const { control, register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      full_name: profile.full_name,
      phone: profile.phone ?? '',
      email: rep?.email ?? '',
      address_street: rep?.address_street ?? '',
      address_city: rep?.address_city ?? '',
      address_province: rep?.address_province ?? NONE,
      address_postal: rep?.address_postal ?? '',
      jacket_size: rep?.jacket_size ?? NONE,
      tshirt_size: rep?.tshirt_size ?? NONE,
    },
  });
  const errors = formState.errors;

  const onSubmit = (values: FormValues) => {
    // Submit ONLY the fields that actually changed (the backend needs ≥1).
    const body: ProfileChangeRequestBody = {};
    if (values.full_name !== profile.full_name) body.full_name = values.full_name;
    if ((values.phone ?? '') !== (profile.phone ?? '')) body.phone = values.phone ?? '';
    if (!rep && photo !== undefined) body.avatar_url = photo;
    if (rep) {
      for (const k of REP_TEXT) {
        const next = values[k].trim();
        if (next && next !== (rep[k] ?? '')) body[k] = next;
      }
      for (const k of REP_PICK) {
        const next = values[k];
        // The Select only offers allowlisted values (province / size enums), so the plain string is safe here.
        if (next !== NONE && next !== (rep[k] ?? NONE)) (body as Record<string, string>)[k] = next;
      }
    }

    if (Object.keys(body).length === 0) {
      toast({ title: 'No changes to submit', tone: 'info' });
      return;
    }
    req.mutate(body, {
      onSuccess: () =>
        toast({
          title: 'Submitted for review',
          description: 'Your profile updates once a reviewer approves it.',
          tone: 'success',
        }),
      onError,
    });
  };

  const pick = (name: (typeof REP_PICK)[number], label: string, options: { value: string; label: string }[]) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FormField label={label} error={errors[name]?.message}>
          <Select options={options} value={field.value} onValueChange={field.onChange} aria-label={label} />
        </FormField>
      )}
    />
  );

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <p className={styles.help}>
        Editing your {rep ? 'name, phone, contact email, address or uniform sizes' : 'name, phone or photo'}{' '}
        creates a <strong>change request</strong>. It is reviewed before it applies, so your live profile won&rsquo;t
        change until then. Your theme applies instantly (see Preferences).
      </p>
      <FormField label="Full name" required error={errors.full_name?.message}>
        <Input {...register('full_name')} />
      </FormField>
      <FormField label="Phone" error={errors.phone?.message}>
        <Input {...register('phone')} placeholder="(204) 555-0123" />
      </FormField>
      {rep ? (
        <p className={styles.help}>Your photo is the headshot HR keeps on file. Ask HR to update it.</p>
      ) : (
        <FormField label="Photo">
          <PhotoPicker name={profile.full_name} currentUrl={profile.avatar_url} value={photo} onChange={setPhoto} />
        </FormField>
      )}

      {rep && (
        <>
          <FormField label="Contact email" error={errors.email?.message} help="Where HR can reach you. Your sign-in email does not change.">
            <Input {...register('email')} type="email" placeholder="you@example.com" />
          </FormField>
          <FormField label="Street" error={errors.address_street?.message}>
            <Input {...register('address_street')} placeholder="1250 Portage Ave" />
          </FormField>
          <FormField label="City" error={errors.address_city?.message}>
            <Input {...register('address_city')} placeholder="Winnipeg" />
          </FormField>
          {pick('address_province', 'Province', PROVINCE_OPTIONS)}
          <FormField label="Postal code" error={errors.address_postal?.message}>
            <Input {...register('address_postal')} placeholder="R3G 0T7" className="mono" />
          </FormField>
          {pick('jacket_size', 'Jacket size', SIZE_OPTIONS)}
          {pick('tshirt_size', 'T-shirt size', SIZE_OPTIONS)}
        </>
      )}

      <div className={styles.actions}>
        <Button variant="primary" type="submit" loading={req.isPending}>
          Submit for review
        </Button>
      </div>
    </form>
  );
}

export function ProfileTab() {
  const q = useAccountProfile();
  const { repId } = useAuth();
  const isRep = !!repId;
  const rep = useMyRepProfile(isRep);
  // A rep's form needs their current rep values before it can show (or diff) them.
  const ready = !isRep || rep.isSuccess || rep.isError;

  return (
    <DataState isLoading={q.isLoading || !ready} isError={q.isError} isEmpty={false} onRetry={() => q.refetch()}>
      {q.data && ready && (
        <div className={styles.stack}>
          <div className={styles.header}>
            <Avatar name={q.data.full_name} src={q.data.avatar_url} size="lg" />
            <div className={styles.identity}>
              <span className={styles.name}>{q.data.full_name}</span>
              <span className={styles.email}>{q.data.email}</span>
            </div>
            <Badge tone={q.data.status === 'active' ? 'success' : 'muted'}>
              {q.data.status === 'active' ? 'Active' : 'Inactive'}
            </Badge>
          </div>

          {q.data.change_pending && q.data.pending_request ? (
            <>
              <PendingChangeBanner request={q.data.pending_request} />
              <p className={styles.help}>You can submit another change once this one is reviewed.</p>
            </>
          ) : (
            <ProfileEditForm profile={q.data} rep={rep.data ?? null} />
          )}

          {isRep && <MyRepProfileSection />}
        </div>
      )}
    </DataState>
  );
}
