/**
 * ChangePasswordRequiredPage — /change-password. The forced gate when `must_change_password` is set (after
 * an invite or an admin temp-password reset). The user signs in with their temp/initial password, then sets
 * a new one (current + new). On success we sign out + back to login (a fresh login clears the flag cleanly).
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, FormField, Input, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useAuth } from '../../../auth/useAuth';
import { useChangePassword } from '../../account/api/useAccountMutations';
import { AuthShell } from '../AuthShell';
import { PASSWORD_HINT, passwordIssues } from '../passwordHints';

export default function ChangePasswordRequiredPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');

  const issues = pw ? passwordIssues(pw) : [];
  const mismatch = confirm !== '' && confirm !== pw;
  const canSubmit = current !== '' && pw !== '' && issues.length === 0 && !mismatch && !change.isPending;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    change.mutate(
      { current_password: current, new_password: pw },
      {
        onSuccess: async () => {
          toast({ title: 'Password updated', description: 'Please sign in with your new password.', tone: 'success' });
          await logout();
          navigate('/login', { replace: true });
        },
        onError,
      },
    );
  };

  return (
    <AuthShell title="Set a new password" subtitle="Before you continue, please choose a new password.">
      <Banner tone="info" title="A password change is required">
        Your account is using a temporary or initial password. Set a new one to continue.
      </Banner>
      <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
        <FormField label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </FormField>
        <FormField label="New password" help={PASSWORD_HINT} error={pw && issues.length ? `Password must ${issues.join(', ')}.` : undefined}>
          <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </FormField>
        <FormField label="Confirm new password" error={mismatch ? 'Passwords do not match.' : undefined}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </FormField>
        <Button type="submit" variant="primary" fullWidth loading={change.isPending} disabled={!canSubmit}>
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
