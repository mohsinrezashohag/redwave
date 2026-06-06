/**
 * LoginPage — the first real screen (SRS §4.2). Email + password, clear error messaging via Banner,
 * and a (placeholder) forgot-password link. Built from foundation components, tokens only, light+dark.
 * The submit is disabled until both fields are filled and shows a loading state; the password is masked
 * and never logged, and the error is the backend's generic message (never reveals which field failed).
 */
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Banner, Button, FormField, Input, Logo, useToast } from '../../components/ui';
import { useAuth } from '../../auth/useAuth';
import { SessionLoading } from '../../auth/SessionLoading';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') return <SessionLoading />;
  if (status === 'authenticated') return <Navigate to="/" replace />;

  const canSubmit = email.trim() !== '' && password !== '' && !submitting;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch {
      setError('Invalid email or password. Please try again.');
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
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>Welcome back — enter your credentials to continue.</p>

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

        <button
          type="button"
          className={styles.forgot}
          onClick={() =>
            toast({
              title: 'Password reset',
              description: 'Contact your administrator to reset your password.',
              tone: 'info',
            })
          }
        >
          Forgot password?
        </button>
      </main>
      <footer className={styles.footer}>Redwave ERP / HRM · Internal</footer>
    </div>
  );
}
