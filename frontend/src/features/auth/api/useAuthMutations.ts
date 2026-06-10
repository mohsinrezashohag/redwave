/**
 * Public auth mutations — forgot-password (request a reset email) + reset-password (consume a token). Both
 * are unauthenticated endpoints. forgot ALWAYS resolves (no account enumeration). — AUTH-002
 */
import { useMutation } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) => unwrap(api.POST('/v1/auth/forgot-password', { body: { email } })),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (body: { token: string; new_password: string }) =>
      unwrap(api.POST('/v1/auth/reset-password', { body })),
  });
}
