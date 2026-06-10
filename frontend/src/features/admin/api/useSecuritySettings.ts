/**
 * Security-settings hooks — the SA's MFA-enforcement policy (master switch + per-role mfa_required).
 * Gated server-side by settings:view (read) / settings:edit (write). — AUTH MFA, arch §security
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import type { components } from '../../../api/generated/schema';

export type SecuritySettings = components['schemas']['SecuritySettingsResponse'];
export type UpdateSecuritySettingsBody = components['schemas']['UpdateSecuritySettingsDto'];

const key = ['admin', 'security-settings'] as const;

export function useSecuritySettings(enabled: boolean) {
  return useQuery({
    queryKey: key,
    queryFn: () => unwrap<SecuritySettings>(api.GET('/v1/security-settings')),
    enabled,
  });
}

export function useSaveSecuritySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSecuritySettingsBody) =>
      unwrap<SecuritySettings>(api.PATCH('/v1/security-settings', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}
