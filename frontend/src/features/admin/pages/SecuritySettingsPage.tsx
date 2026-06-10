/**
 * SecuritySettingsPage — the Super-Admin MFA-enforcement policy. A master "enforce MFA" switch + a per-role
 * "MFA required" grid. Enforcement defaults OFF so MFA can roll out per-user without locking testers out;
 * once ON, members of an mfa_required role must enrol before continuing. `settings:view` to load,
 * `settings:edit` to save (server is the real gate). — AUTH MFA, arch §security
 */
import { useEffect, useState } from 'react';
import { Banner, Button, Card, PageHeader, Switch, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden } from '../../../lib/api/apiError';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useSaveSecuritySettings, useSecuritySettings } from '../api/useSecuritySettings';
import styles from '../admin.module.css';

export default function SecuritySettingsPage() {
  const canView = useCan('settings:view');
  const canEdit = useCan('settings:edit');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const q = useSecuritySettings(canView);
  const save = useSaveSecuritySettings();

  const [enforced, setEnforced] = useState(false);
  const [roleFlags, setRoleFlags] = useState<Record<string, boolean>>({});

  // Seed local state from the loaded settings.
  useEffect(() => {
    if (q.data) {
      setEnforced(q.data.mfa_enforced);
      setRoleFlags(Object.fromEntries(q.data.roles.map((r) => [r.id, r.mfa_required])));
    }
  }, [q.data]);

  if (!canView || isForbidden(q.error)) {
    return <AccessDenied message="Security settings require the settings view permission." />;
  }

  const roles = q.data?.roles ?? [];
  const dirty =
    !!q.data &&
    (enforced !== q.data.mfa_enforced ||
      q.data.roles.some((r) => roleFlags[r.id] !== r.mfa_required));

  const onSave = () => {
    const changedRoles = roles
      .filter((r) => roleFlags[r.id] !== r.mfa_required)
      .map((r) => ({ role_id: r.id, mfa_required: roleFlags[r.id] }));
    save.mutate(
      { mfa_enforced: enforced, role_mfa: changedRoles },
      { onSuccess: () => toast({ title: 'Security settings saved', tone: 'success' }), onError },
    );
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Security settings"
        subtitle="Multi-factor authentication policy. Any user can enrol from My Account → Security; these controls decide when MFA is REQUIRED."
      />
      <DataState isLoading={q.isLoading} isError={q.isError} onRetry={() => q.refetch()}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 'var(--text-md)' }}>Enforce MFA</h3>
                <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                  When ON, members of an MFA-required role must enrol before using the app. Leave OFF while
                  testers are still onboarding — they can enrol voluntarily in the meantime.
                </p>
              </div>
              <Switch checked={enforced} onCheckedChange={setEnforced} disabled={!canEdit} tone="success" />
            </div>
            {enforced && (
              <Banner tone="warning" title="Enforcement is on">
                Make sure required-role members (including you) have a working authenticator before relying on
                this — recovery codes are the fallback.
              </Banner>
            )}
          </Card>

          <Card>
            <h3 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-md)' }}>MFA required by role</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {roles.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-2) var(--space-3)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <strong style={{ fontSize: 'var(--text-sm)' }}>{r.name}</strong>
                  <Switch
                    checked={roleFlags[r.id] ?? false}
                    onCheckedChange={(v) => setRoleFlags((prev) => ({ ...prev, [r.id]: v }))}
                    disabled={!canEdit}
                  />
                </div>
              ))}
            </div>
          </Card>

          {canEdit && (
            <div>
              <Button variant="primary" onClick={onSave} loading={save.isPending} disabled={!dirty}>
                Save changes
              </Button>
            </div>
          )}
        </div>
      </DataState>
    </div>
  );
}
