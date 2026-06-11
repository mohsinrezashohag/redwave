/**
 * Role hooks — list/get + create/update/set-permissions/delete. The backend blocks rename + delete of
 * built-in (`is_system`) roles with 409 (the UI also prevents offering those); setPermissions IS allowed
 * on built-in roles. Mutations invalidate the roles cache. Responses `never`-typed → cast to hand types.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import { rolesKeys } from './keys';
import type { CreateRoleBody, RoleDetail, RoleSummary, SetRolePermissionsBody, UpdateRoleBody } from '../roles.types';

export function useRoles(enabled = true) {
  return useQuery({
    queryKey: rolesKeys.list(),
    queryFn: () => unwrapList<RoleSummary>(api.GET('/v1/roles')),
    enabled,
  });
}

export function useRole(id: string | undefined) {
  return useQuery({
    queryKey: rolesKeys.detail(id ?? ''),
    queryFn: () => unwrap<RoleDetail>(api.GET('/v1/roles/{id}', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRoleBody) => unwrap<RoleDetail>(api.POST('/v1/roles', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKeys.all }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRoleBody }) =>
      unwrap<RoleDetail>(api.PATCH('/v1/roles/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKeys.all }),
  });
}

export function useSetRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SetRolePermissionsBody }) =>
      unwrap<RoleDetail>(api.PUT('/v1/roles/{id}/permissions', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKeys.all }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<unknown>(api.DELETE('/v1/roles/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKeys.all }),
  });
}
