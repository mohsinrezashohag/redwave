/**
 * LoginPage — email + password (SRS §4.2). On success the server sets the httpOnly refresh + readable CSRF
 * cookies and returns an access token. If the account has MFA enabled, the password step returns an MFA
 * challenge and the page switches to a 6-digit code / recovery-code entry (no session until verified). The
 * password is masked, never logged; the error is the backend's message (lockout) or a generic credential error.
 */
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Banner, Button, FormField, Input, Logo } from '../../components/ui';
import { useAuth } from '../../auth/useAuth';
import { SessionLoading } from '../../auth/SessionLoading';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const { status, login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  if (status === 'loading') return <SessionLoading />;
  if (status === 'authenticated') return <Navigate to="/" replace />;

  const canSubmit = email.trim() !== '' && password !== '' && !submitting;
  const canVerify = code.trim() !== '' && !submitting;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email.trim(), password);
      if (result.kind === 'mfa') {
        setMfaToken(result.mfaToken); // switch to the second-factor step
        return;
      }
      navigate('/', { replace: true }); // a must-change-password / MFA-enrolment user is routed by the shell guard
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(/lock/i.test(msg) ? msg : 'Invalid email or password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!canVerify || !mfaToken) return;
    setError(null);
    setSubmitting(true);
    try {
      await verifyMfa(mfaToken, code.trim());
      navigate('/', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // An expired challenge sends the user back to the password step.
      if (/expired/i.test(msg)) {
        setMfaToken(null);
        setCode('');
        setError('Your sign-in timed out. Please enter your password again.');
      } else {
        setError('That code was not valid. Try again, or use a recovery code.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <div className={styles.brand}>
          <Logo variant="full" size="lg" />
        </div>

        {mfaToken ? (
          <>
            <h1 className={styles.title}>Two-factor authentication</h1>
            <p className={styles.subtitle}>Enter the 6-digit code from your authenticator app, or a recovery code.</p>
            {error && (
              <Banner tone="danger" title="Verification failed">
                {error}
              </Banner>
            )}
            <form className={styles.form} onSubmit={onVerify} noValidate>
              <FormField label="Authentication code">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                />
              </FormField>
              <Button type="submit" variant="primary" fullWidth loading={submitting} disabled={!canVerify}>
                Verify
              </Button>
            </form>
            <button
              type="button"
              className={styles.forgot}
              onClick={() => {
                setMfaToken(null);
                setCode('');
                setError(null);
              }}
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Sign in</h1>
            <p className={styles.subtitle}>Welcome back. Sign in to continue.</p>
            {error && (
              <Banner tone="danger" title="Sign-in failed">
                {error}
              </Banner>
            )}
            <form className={styles.form} onSubmit={onSubmit} noValidate>
              <FormField label="Email">
                <Input
                  type="email"
                  autoComplete="username"
                  placeholder="you@redwave.local"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </FormField>
              <FormField label="Password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FormField>
              <Button type="submit" variant="primary" fullWidth loading={submitting} disabled={!canSubmit}>
                Sign in
              </Button>
            </form>
            <button type="button" className={styles.forgot} onClick={() => navigate('/forgot-password')}>
              Forgot password?
            </button>
          </>
        )}
      </main>
      <footer className={styles.footer}>Redwave ERP / HRM · Internal</footer>
    </div>
  );
}
