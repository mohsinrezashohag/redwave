/**
 * BroadcastPage — the Super-Admin manual broadcast composer (SRS §14 / notifications:broadcast). Compose a
 * one-off announcement (title + body) and choose an audience (everyone / a role / specific people); the
 * server fans it out to the active targeted users (+ email where that channel is on) and returns the
 * recipient count. Gated `notifications:broadcast` (SA) — a 403 renders AccessDenied; the server is the
 * real gate (§5). Unlike automatic events, a broadcast targets freely — automatic events are never
 * silently re-routed.
 */
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Banner, Button, FormField, Input, MultiSelect, PageHeader, SegmentedControl, Select, Textarea, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCan } from '../../../auth/useCan';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useRoles } from '../../admin/api/useRoles';
import { useUsers } from '../../admin/api/useUsers';
import { useBroadcast } from '../api/useNotifications';
import type { BroadcastBody } from '../notifications.types';
import styles from './Broadcast.module.css';

const schema = z
  .object({
    title: z.string().min(1, 'A title is required').max(200, 'Max 200 characters'),
    body: z.string().min(1, 'A message is required').max(1000, 'Max 1000 characters'),
    kind: z.enum(['all', 'role', 'users']),
    role: z.string().optional(),
    userIds: z.array(z.string()).optional(),
  })
  .refine((v) => v.kind !== 'role' || !!v.role, { message: 'Choose a role', path: ['role'] })
  .refine((v) => v.kind !== 'users' || (v.userIds?.length ?? 0) > 0, { message: 'Choose at least one person', path: ['userIds'] });

type FormValues = z.infer<typeof schema>;

export default function BroadcastPage() {
  const canBroadcast = useCan('notifications:broadcast');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const broadcast = useBroadcast();
  const roles = useRoles(canBroadcast);
  const users = useUsers(canBroadcast);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', body: '', kind: 'all', role: undefined, userIds: [] },
  });
  const kind = form.watch('kind');

  if (!canBroadcast) {
    return <AccessDenied message="Sending broadcasts requires the notifications broadcast permission (Super Admin)." />;
  }

  const roleOptions = (roles.data ?? []).map((r) => ({ value: r.name, label: r.name }));
  const userOptions = (users.data ?? [])
    .filter((u) => u.status === 'active')
    .map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` }));

  const onSubmit = form.handleSubmit((values) => {
    const audience: BroadcastBody['audience'] =
      values.kind === 'role'
        ? { kind: 'role', role: values.role }
        : values.kind === 'users'
          ? { kind: 'users', userIds: values.userIds }
          : { kind: 'all' };
    const body: BroadcastBody = { title: values.title, body: values.body, audience };
    broadcast.mutate(body, {
      onSuccess: (res) => {
        toast({ title: `Broadcast sent to ${res.recipients} user(s)`, tone: 'success' });
        form.reset({ title: '', body: '', kind: 'all', role: undefined, userIds: [] });
      },
      onError,
    });
  });

  return (
    <div className={styles.page}>
      <PageHeader
        title="Send a broadcast"
        subtitle="Compose a one-off announcement to everyone, a role, or specific people. Automatic event notifications are configured separately and are never re-routed here."
      />
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <FormField label="Title" error={form.formState.errors.title?.message}>
          <Input placeholder="e.g. System maintenance tonight" {...form.register('title')} />
        </FormField>

        <FormField label="Message" error={form.formState.errors.body?.message}>
          <Textarea rows={4} placeholder="What do you want everyone to know?" {...form.register('body')} />
        </FormField>

        <FormField label="Audience" error={form.formState.errors.role?.message ?? (form.formState.errors.userIds?.message as string | undefined)}>
          <div className={styles.audience}>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <SegmentedControl<'all' | 'role' | 'users'>
                  options={[
                    { value: 'all', label: 'Everyone' },
                    { value: 'role', label: 'A role' },
                    { value: 'users', label: 'Specific people' },
                  ]}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />

            {kind === 'role' && (
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select
                    options={roleOptions}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={roles.isLoading ? 'Loading roles…' : 'Choose a role'}
                  />
                )}
              />
            )}

            {kind === 'users' && (
              <Controller
                control={form.control}
                name="userIds"
                render={({ field }) => (
                  <MultiSelect
                    options={userOptions}
                    value={field.value ?? []}
                    onChange={field.onChange}
                    placeholder={users.isLoading ? 'Loading people…' : 'Add people…'}
                  />
                )}
              />
            )}
          </div>
        </FormField>

        <Banner tone="info">
          Recipients receive an in-app notification (and an email if the broadcast channel is enabled). The
          message is delivered to active users only.
        </Banner>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={broadcast.isPending}>
            Send broadcast
          </Button>
        </div>
      </form>
    </div>
  );
}
