/**
 * SecurityTab — change password (RHF+zod). New password ≥8 with a confirm-match check; the current
 * password is verified server-side (wrong → 400 surfaced as a toast). Fields are type="password" and are
 * never logged or echoed. On success the form resets. Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, FormField, Input, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useChangePassword } from '../api/useAccountMutations';
import { MfaSection } from './MfaSection';
import { SessionsSection } from './SessionsSection';
import styles from './account.module.css';

const schema = z
  .object({
    current_password: z.string().min(1, 'Required'),
    new_password: z.string().min(8, 'At least 8 characters').max(128),
    confirm_password: z.string().min(1, 'Required'),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });
type FormValues = z.infer<typeof schema>;

export function SecurityTab() {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const change = useChangePassword();
  const { register, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });
  const errors = formState.errors;

  const onSubmit = (values: FormValues) => {
    change.mutate(
      { current_password: values.current_password, new_password: values.new_password },
      {
        onSuccess: () => {
          toast({ title: 'Password changed', tone: 'success' });
          reset();
        },
        onError,
      },
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Current password" required error={errors.current_password?.message}>
          <Input type="password" autoComplete="current-password" {...register('current_password')} />
        </FormField>
        <FormField label="New password" required error={errors.new_password?.message} help="At least 8 characters.">
          <Input type="password" autoComplete="new-password" {...register('new_password')} />
        </FormField>
        <FormField label="Confirm new password" required error={errors.confirm_password?.message}>
          <Input type="password" autoComplete="new-password" {...register('confirm_password')} />
        </FormField>
        <div className={styles.actions}>
          <Button variant="primary" type="submit" loading={change.isPending}>
            Change password
          </Button>
        </div>
      </form>
      <MfaSection />
      <SessionsSection />
    </div>
  );
}
