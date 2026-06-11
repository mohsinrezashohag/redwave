/**
 * User-management hooks — list/get + create/update/set-roles. TanStack Query over the typed client via
 * `unwrap<T>()` (the playbook). Mutations invalidate the user list. Soft-deactivate is a status PATCH
 * (never a hard delete). Responses are `never`-typed → cast to hand types. Toasts via the caller.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { usersKeys } from './keys';
import type { AdminUser, CreateUserBody, SetUserRolesBody, UpdateUserBody } from '../users.types';

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: usersKeys.list(),
    queryFn: () => unwrapList<AdminUser>(api.GET('/v1/users')),
    enabled,
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: usersKeys.detail(id ?? ''),
    queryFn: () => unwrap<AdminUser>(api.GET('/v1/users/{id}', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserBody) => unwrap<AdminUser>(api.POST('/v1/users', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKeys.all }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserBody }) =>
      unwrap<AdminUser>(api.PATCH('/v1/users/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKeys.all }),
  });
}

export function useSetUserRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SetUserRolesBody }) =>
      unwrap<AdminUser>(api.PUT('/v1/users/{id}/roles', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKeys.all }),
  });
}

/** Admin-assisted reset — emails the user a reset LINK or a forced-change TEMP password (never shown to the admin). */
export function useResetUserPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: 'link' | 'temp' }) =>
      unwrap<{ success: true }>(api.POST('/v1/users/{id}/reset-password', { params: { path: { id } }, body: { mode } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKeys.all }),
  });
}

/** SA force-logout — revoke every one of the user's sessions (all devices). — arch §security */
export function useForceLogout() {
  return useMutation({
    mutationFn: (id: string) => unwrap<{ success: true }>(api.POST('/v1/users/{id}/revoke-sessions', { params: { path: { id } } })),
  });
}

/** SA disables a user's MFA (lost-device recovery). — arch §security */
export function useDisableUserMfa() {
  return useMutation({
    mutationFn: (id: string) => unwrap<{ success: true }>(api.POST('/v1/users/{id}/disable-mfa', { params: { path: { id } } })),
  });
}
