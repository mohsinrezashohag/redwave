/**
 * ResetPasswordPage — /reset-password and /set-password (public). Reads the `?token=` from the emailed link,
 * collects a new password (mirrors the server policy as a hint; the server is the real gate), and POSTs to
 * /v1/auth/reset-password. Used for BOTH the forgot-password reset and the first-login invite (copy varies).
 */
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Banner, Button, FormField, Input } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { AuthShell } from '../AuthShell';
import { PASSWORD_HINT, passwordIssues } from '../passwordHints';
import { useResetPassword } from '../api/useAuthMutations';

export default function ResetPasswordPage({ flavor = 'reset' }: { flavor?: 'reset' | 'invite' }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const reset = useResetPassword();
  const onError = useApiErrorToast();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const issues = pw ? passwordIssues(pw) : [];
  const mismatch = confirm !== '' && confirm !== pw;
  const canSubmit = !!token && pw !== '' && issues.length === 0 && !mismatch && !reset.isPending;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    reset.mutate({ token, new_password: pw }, { onSuccess: () => setDone(true), onError });
  };

  const title = flavor === 'invite' ? 'Set your password' : 'Choose a new password';
  const subtitle = flavor === 'invite' ? 'Welcome to Redwave — set a password to activate your account.' : 'Enter a new password for your account.';

  if (!token) {
    return (
      <AuthShell title={title}>
        <Banner tone="danger" title="Missing or invalid link">
          This link is missing its token. Request a new one from the sign-in page.
        </Banner>
        <p style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}><Link to="/forgot-password">Request a new link</Link></p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={title} subtitle={subtitle}>
      {done ? (
        <>
          <Banner tone="success" title="Password set">Your password is ready. You can now sign in.</Banner>
          <p style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}><Link to="/login">Go to sign in</Link></p>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <FormField label="New password" help={PASSWORD_HINT} error={pw && issues.length ? `Password must ${issues.join(', ')}.` : undefined}>
            <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Confirm password" error={mismatch ? 'Passwords do not match.' : undefined}>
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </FormField>
          <Button type="submit" variant="primary" fullWidth loading={reset.isPending} disabled={!canSubmit}>
            {flavor === 'invite' ? 'Activate account' : 'Reset password'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
