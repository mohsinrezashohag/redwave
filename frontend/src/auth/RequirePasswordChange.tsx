/**
 * RequirePasswordChange — once authenticated, force a user whose `must_change_password` is set (post-invite
 * or admin temp-password reset) to the /change-password screen before they can use the app. The server is
 * the real gate (it set the flag); this just routes. — AUTH-002
 */
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';

export function RequirePasswordChange() {
  const { user } = useAuth();
  if (user?.must_change_password) {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}
