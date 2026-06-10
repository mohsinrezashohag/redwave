/**
 * SessionsSection — the caller's active sessions (devices), with per-device revoke. Revoking a session
 * logs that device out immediately (the server rejects any access token whose session is revoked). The
 * current device shows a badge and isn't revocable here (use Log out). — arch §security (sessions)
 */
import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useRevokeSession, useSessions, type Session } from '../api/useSecurity';

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /edg/i.test(ua) ? 'Edge' : /chrome/i.test(ua) ? 'Chrome' : /firefox/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser';
  const os = /windows/i.test(ua) ? 'Windows' : /mac os|macintosh/i.test(ua) ? 'macOS' : /android/i.test(ua) ? 'Android' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /linux/i.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

const when = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

export function SessionsSection() {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const [target, setTarget] = useState<Session | null>(null);

  return (
    <Card>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--text-md)' }}>Active sessions</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          Devices currently signed in to your account. Revoke any you don’t recognise.
        </p>
      </div>

      <DataState
        isLoading={sessions.isLoading}
        isError={sessions.isError}
        isEmpty={(sessions.data?.length ?? 0) === 0}
        onRetry={() => sessions.refetch()}
        emptyNode={<p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>No active sessions.</p>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {(sessions.data ?? []).map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                padding: 'var(--space-3)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <strong style={{ fontSize: 'var(--text-sm)' }}>{describeAgent(s.user_agent)}</strong>
                  {s.is_current && <Badge tone="info">This device</Badge>}
                </div>
                <div className="mono" style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
                  {s.ip_address ?? 'IP unknown'} · last used {when(s.last_used_at)}
                </div>
              </div>
              <Button variant="tertiary" disabled={s.is_current} onClick={() => setTarget(s)}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      </DataState>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Revoke this session?"
        description="That device will be signed out immediately and must log in again."
        confirmLabel="Revoke"
        loading={revoke.isPending}
        onConfirm={() => {
          if (!target) return;
          revoke.mutate(target.id, {
            onSuccess: () => {
              toast({ title: 'Session revoked', tone: 'success' });
              setTarget(null);
            },
            onError,
          });
        }}
      />
    </Card>
  );
}
