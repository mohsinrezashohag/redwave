/**
 * Security hooks — MFA (TOTP) enrollment + active sessions, for the My Account → Security tab.
 * MFA endpoints are authenticated-self (no module permission); sessions are own-scoped. — arch §security
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import type { components } from '../../../api/generated/schema';

export type MfaStatus = components['schemas']['MfaStatusResponse'];
export type MfaSetup = components['schemas']['MfaSetupResponse'];
export type MfaRecoveryCodes = components['schemas']['MfaRecoveryCodesResponse'];
export type Session = components['schemas']['SessionResponse'];

const securityKeys = {
  mfa: ['security', 'mfa'] as const,
  sessions: ['security', 'sessions'] as const,
};

export function useMfaStatus() {
  return useQuery({
    queryKey: securityKeys.mfa,
    queryFn: () => unwrap<MfaStatus>(api.GET('/v1/auth/mfa/status')),
  });
}

export function useMfaSetup() {
  return useMutation({ mutationFn: () => unwrap<MfaSetup>(api.POST('/v1/auth/mfa/setup')) });
}

export function useMfaEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => unwrap<MfaRecoveryCodes>(api.POST('/v1/auth/mfa/enable', { body: { code } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: securityKeys.mfa }),
  });
}

export function useMfaDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => unwrap<{ success: true }>(api.POST('/v1/auth/mfa/disable', { body: { code } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: securityKeys.mfa }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: securityKeys.sessions,
    queryFn: () => unwrap<Session[]>(api.GET('/v1/auth/sessions')),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<void>(api.DELETE('/v1/auth/sessions/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: securityKeys.sessions }),
  });
}
