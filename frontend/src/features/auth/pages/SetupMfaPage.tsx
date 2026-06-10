/**
 * SetupMfaPage — /setup-mfa. The forced enrollment gate when policy requires MFA and the user hasn't
 * enrolled (RequireMfaEnrollment routes here; it sits OUTSIDE that gate so it's reachable). Reuses the
 * account MfaSection; on enrol we reload /me (clearing the gate) and continue into the app. — AUTH MFA
 */
import { Navigate, useNavigate } from 'react-router-dom';
import { Banner } from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { MfaSection } from '../../account/components/MfaSection';
import { AuthShell } from '../AuthShell';

export default function SetupMfaPage() {
  const { logout, reloadMe, mfaEnrollmentRequired } = useAuth();
  const navigate = useNavigate();

  // Already enrolled (or policy changed) → straight into the app.
  if (!mfaEnrollmentRequired) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthShell title="Set up two-factor authentication" subtitle="Your administrator requires MFA on your account.">
      <Banner tone="info" title="Two-factor authentication is required">
        Enrol an authenticator app to continue. Keep your recovery codes somewhere safe.
      </Banner>
      <div style={{ marginTop: 'var(--space-4)' }}>
        <MfaSection
          onEnabled={async () => {
            await reloadMe();
            navigate('/', { replace: true });
          }}
        />
      </div>
      <button
        type="button"
        style={{
          marginTop: 'var(--space-4)',
          background: 'none',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
        }}
        onClick={() => logout()}
      >
        Sign out
      </button>
    </AuthShell>
  );
}
