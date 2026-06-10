/**
 * RequireMfaEnrollment — once authenticated, if policy requires MFA and the user hasn't enrolled, force them
 * to /setup-mfa before they can use the app (mirrors RequirePasswordChange). The server is the real gate
 * (it set the flag on /me); this just routes. Enforcement defaults off, so this rarely fires. — AUTH MFA
 */
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';

export function RequireMfaEnrollment() {
  const { mfaEnrollmentRequired } = useAuth();
  if (mfaEnrollmentRequired) {
    return <Navigate to="/setup-mfa" replace />;
  }
  return <Outlet />;
}
