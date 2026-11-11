/**
 * UserFormModal — create (INVITE) or edit a user (RHF+zod, the playbook). CREATE emails the user a
 * set-password link (the admin never sees/sets a password — the backend invites, AUTH-002). EDIT changes
 * name/phone/status + roles. Self-guardrails: you can't change your OWN status or roles here (the server has
 * no self-protection, so we don't offer it). A password RESET is a row action (link / temp), not here.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Banner,
  Button,
  FormField,
  Input,
  Modal,
  MultiSelect,
  Select,
  useToast,
} from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useRoles } from '../api/useRoles';
import { useCreateUser, useSetUserRoles, useUpdateUser } from '../api/useUsers';
import type { AdminUser } from '../users.types';
import styles from './users.module.css';

export type UserFormState = { mode: 'create' } | { mode: 'edit'; user: AdminUser } | null;

const createSchema = z.object({
  email: z.string().email('Enter a valid email'),
  full_name: z.string().min(1, 'Required').max(150),
  phone: z.string().max(50).optional(),
  role_ids: z.array(z.string().uuid()),
});
type CreateValues = z.infer<typeof createSchema>;

const editSchema = z.object({
  full_name: z.string().min(1, 'Required').max(150),
  phone: z.string().max(50).optional(),
  status: z.enum(['active', 'inactive']),
  role_ids: z.array(z.string().uuid()),
});
type EditValues = z.infer<typeof editSchema>;

function CreateUserForm({
  roleOptions,
  onDone,
}: {
  roleOptions: { value: string; label: string }[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateUser();
  const { control, register, handleSubmit, formState } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { email: '', full_name: '', phone: '', role_ids: [] },
  });
  const errors = formState.errors;

  const onSubmit = (values: CreateValues) =>
    create.mutate(
      {
        email: values.email,
        full_name: values.full_name,
        phone: values.phone || undefined,
        role_ids: values.role_ids,
        // No password → the backend INVITES: it emails the user a set-password link (the admin never sets one).
      },
      {
        onSuccess: () => {
          toast({ title: 'Invitation sent', description: 'The user will receive an email to set their password.', tone: 'success' });
          onDone();
        },
        onError,
      },
    );

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <Banner tone="info" title="The user sets their own password">
        We email them a secure link to set a password, so you never see or choose it. You can also send a reset later from the user’s row.
      </Banner>
      <FormField label="Email" required error={errors.email?.message}>
        <Input type="email" {...register('email')} placeholder="jane@redwave.local" />
      </FormField>
      <FormField label="Full name" required error={errors.full_name?.message}>
        <Input {...register('full_name')} placeholder="Jane Doe" />
      </FormField>
      <FormField label="Phone" error={errors.phone?.message}>
        <Input {...register('phone')} placeholder="(204) 555-0123" />
      </FormField>
      <Controller
        control={control}
        name="role_ids"
        render={({ field }) => (
          <FormField label="Roles" help="A user may hold several; effective permissions are the union.">
            <MultiSelect options={roleOptions} value={field.value} onChange={field.onChange} placeholder="Add role" />
          </FormField>
        )}
      />
      <div className={styles.footer}>
        <Button variant="secondary" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={create.isPending}>
          Send invitation
        </Button>
      </div>
    </form>
  );
}

function EditUserForm({
  user,
  roleOptions,
  onDone,
}: {
  user: AdminUser;
  roleOptions: { value: string; label: string }[];
  onDone: () => void;
}) {
  const { user: me } = useAuth();
  const isSelf = me?.id === user.id;
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const update = useUpdateUser();
  const setRoles = useSetUserRoles();

  const currentRoleIds = user.user_roles.map((r) => r.role.id);
  const { control, register, handleSubmit, formState } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      full_name: user.full_name,
      phone: user.phone ?? '',
      status: user.status,
      role_ids: currentRoleIds,
    },
  });
  const errors = formState.errors;

  const onSubmit = async (values: EditValues) => {
    try {
      await update.mutateAsync({
        id: user.id,
        body: { full_name: values.full_name, phone: values.phone || undefined, status: isSelf ? user.status : values.status },
      });
      const next = [...values.role_ids].sort().join(',');
      const cur = [...currentRoleIds].sort().join(',');
      if (!isSelf && next !== cur) {
        await setRoles.mutateAsync({ id: user.id, body: { role_ids: values.role_ids } });
      }
      toast({ title: 'User updated', tone: 'success' });
      onDone();
    } catch (e) {
      onError(e);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField label="Email">
        <Input value={user.email} readOnly disabled />
      </FormField>
      <FormField label="Full name" required error={errors.full_name?.message}>
        <Input {...register('full_name')} />
      </FormField>
      <FormField label="Phone" error={errors.phone?.message}>
        <Input {...register('phone')} />
      </FormField>
      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <FormField label="Status" help={isSelf ? 'You can’t change your own status.' : 'Inactive revokes access immediately.'}>
            <Select
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
              value={field.value}
              onValueChange={field.onChange}
              disabled={isSelf}
            />
          </FormField>
        )}
      />
      <Controller
        control={control}
        name="role_ids"
        render={({ field }) => (
          <FormField label="Roles" help={isSelf ? 'You can’t change your own roles.' : 'Effective permissions are the union of these roles.'}>
            <MultiSelect options={roleOptions} value={field.value} onChange={isSelf ? () => {} : field.onChange} placeholder="Add role" />
          </FormField>
        )}
      />
      <div className={styles.footer}>
        <Button variant="secondary" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={update.isPending || setRoles.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

export function UserFormModal({ state, onClose }: { state: UserFormState; onClose: () => void }) {
  const open = state !== null;
  const roles = useRoles(open);
  const roleOptions = (roles.data ?? []).map((r) => ({ value: r.id, label: r.name }));

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={state?.mode === 'edit' ? 'Edit user' : 'Create user'}>
      {state?.mode === 'create' && <CreateUserForm roleOptions={roleOptions} onDone={onClose} />}
      {state?.mode === 'edit' && <EditUserForm user={state.user} roleOptions={roleOptions} onDone={onClose} />}
      {open && roles.isError && (
        <Banner tone="warning" title="Couldn’t load roles">
          Role options are unavailable right now. You can still save the other fields.
        </Banner>
      )}
    </Modal>
  );
}
