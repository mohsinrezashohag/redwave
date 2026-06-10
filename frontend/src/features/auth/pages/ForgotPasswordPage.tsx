/**
 * ForgotPasswordPage — /forgot-password (public). Enter an email → POST /v1/auth/forgot-password. The
 * server never reveals whether the account exists, so we always show the same "check your email" message.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Banner, Button, FormField, Input } from '../../../components/ui';
import { AuthShell } from '../AuthShell';
import { useForgotPassword } from '../api/useAuthMutations';

export default function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    forgot.mutate(email.trim(), { onSuccess: () => setSent(true), onError: () => setSent(true) }); // never reveal existence
  };

  return (
    <AuthShell title="Reset your password" subtitle="Enter your email and we’ll send you a reset link.">
      {sent ? (
        <Banner tone="success" title="Check your email">
          If an account exists for <strong>{email.trim()}</strong>, a password-reset link is on its way. The link expires in 1 hour.
        </Banner>
      ) : (
        <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <FormField label="Email">
            <Input type="email" autoComplete="username" placeholder="you@redwave.local" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </FormField>
          <Button type="submit" variant="primary" fullWidth loading={forgot.isPending} disabled={!email.trim() || forgot.isPending}>
            Send reset link
          </Button>
        </form>
      )}
      <p style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
