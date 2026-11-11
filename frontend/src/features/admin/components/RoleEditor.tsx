/**
 * RoleEditor — create/edit a role: name + description + the PermissionMatrix. Built-in rules (per the
 * backend): built-in roles canNOT be renamed (name field disabled; the server 409s) but their permissions
 * CAN be edited (setPermissions has no is_system guard) — shown with a warning. EXCEPTION: Super Admin is
 * fully read-only here (it holds all grants; neutering it would lock everyone out, and the server has no
 * self-protection). Reuses the playbook (RHF+zod for the fields; the matrix owns its Set). Tokens only.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Badge, Banner, Button, FormField, Input, Textarea, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useCreateRole, useSetRolePermissions, useUpdateRole } from '../api/useRoles';
import { PermissionMatrix } from './PermissionMatrix';
import type { Module, Permission, RoleDetail, UpdateRoleBody } from '../roles.types';
import styles from './roles.module.css';

const schema = z.object({
  name: z.string().min(1, 'Required').max(100),
  description: z.string().max(255).optional(),
});
type FormValues = z.infer<typeof schema>;

export function RoleEditor({
  role,
  modules,
  permissions,
}: {
  role?: RoleDetail;
  modules: Module[];
  permissions: Permission[];
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const create = useCreateRole();
  const update = useUpdateRole();
  const setPerms = useSetRolePermissions();

  const isBuiltIn = !!role?.is_system;
  const isSuperAdmin = role?.name === 'Super Admin';
  const readOnly = isSuperAdmin; // the whole editor is locked for Super Admin

  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions.map((p) => p.id) ?? []));

  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: role?.name ?? '', description: role?.description ?? '' },
  });
  const errors = formState.errors;

  const pending = create.isPending || update.isPending || setPerms.isPending;

  const onSubmit = async (values: FormValues) => {
    try {
      if (!role) {
        await create.mutateAsync({
          name: values.name,
          description: values.description || undefined,
          permission_ids: [...selected],
        });
        toast({ title: 'Role created', tone: 'success' });
      } else {
        const body: UpdateRoleBody = {};
        if (!isBuiltIn && values.name !== role.name) body.name = values.name; // never send a new name for built-in
        if ((values.description || '') !== (role.description || '')) body.description = values.description || '';
        if (Object.keys(body).length > 0) await update.mutateAsync({ id: role.id, body });
        await setPerms.mutateAsync({ id: role.id, body: { permission_ids: [...selected] } });
        toast({ title: 'Role saved', tone: 'success' });
      }
      navigate('/admin/roles');
    } catch (e) {
      onError(e);
    }
  };

  return (
    <form className={styles.editor} onSubmit={handleSubmit(onSubmit)} noValidate>
      {isBuiltIn && !isSuperAdmin && (
        <Banner tone="warning" title="Built-in role">
          This is a built-in role. Its name can&rsquo;t be changed, but you can adjust its permissions.
          <strong> Editing them affects everyone assigned this role.</strong>
        </Banner>
      )}
      {isSuperAdmin && (
        <Banner tone="info" title="Super Admin is protected">
          Super Admin is a built-in role that holds every permission and is read-only here, so it can never
          be locked out.
        </Banner>
      )}

      <div className={styles.fields}>
        <FormField label="Role name" required error={errors.name?.message} help={isBuiltIn ? 'Built-in roles can’t be renamed.' : undefined}>
          <Input {...register('name')} disabled={isBuiltIn || readOnly} />
        </FormField>
        <FormField label="Description" error={errors.description?.message}>
          <Textarea {...register('description')} disabled={readOnly} placeholder="What this role is for…" />
        </FormField>
      </div>

      <div>
        <div className={styles.matrixHead}>
          <h3 className={styles.matrixTitle}>Permissions</h3>
          <span className={styles.count}>
            <span className="mono">{selected.size}</span> granted
          </span>
        </div>
        <PermissionMatrix modules={modules} permissions={permissions} selected={selected} onChange={setSelected} readOnly={readOnly} />
      </div>

      <div className={styles.footer}>
        <Button variant="secondary" type="button" onClick={() => navigate('/admin/roles')}>
          {readOnly ? 'Back' : 'Cancel'}
        </Button>
        {!readOnly && (
          <Button variant="primary" type="submit" loading={pending}>
            {role ? 'Save role' : 'Create role'}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Small badge marking a built-in role (reused by the list + editor header). */
export function BuiltInBadge() {
  return <Badge tone="info">Built-in</Badge>;
}
