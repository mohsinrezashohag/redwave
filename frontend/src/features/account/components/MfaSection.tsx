/**
 * MfaSection — self-service TOTP enrollment for My Account → Security (also reused on the enforced
 * enrollment page). Flow: Enable → setup (QR + secret) → verify a first code → recovery codes shown ONCE
 * → enabled. Disable requires a current code. The secret/codes are server-issued; the UI stores nothing.
 * — AUTH MFA
 */
import { useState } from 'react';
import { Badge, Banner, Button, Card, FormField, Input, Modal, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useMfaDisable, useMfaEnable, useMfaSetup, useMfaStatus, type MfaSetup } from '../api/useSecurity';

export function MfaSection({ onEnabled }: { onEnabled?: () => void } = {}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const status = useMfaStatus();
  const setup = useMfaSetup();
  const enable = useMfaEnable();
  const disable = useMfaDisable();

  const [provisioning, setProvisioning] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  const enabled = status.data?.enabled ?? false;

  const startSetup = () => {
    setup.mutate(undefined, {
      onSuccess: (data) => {
        setProvisioning(data);
        setCode('');
      },
      onError,
    });
  };

  const confirmEnable = () => {
    enable.mutate(code.trim(), {
      onSuccess: (data) => {
        setRecoveryCodes(data.recovery_codes);
        setProvisioning(null);
        setCode('');
        toast({ title: 'Two-factor authentication enabled', tone: 'success' });
        onEnabled?.();
      },
      onError,
    });
  };

  const confirmDisable = () => {
    disable.mutate(disableCode.trim(), {
      onSuccess: () => {
        setDisableOpen(false);
        setDisableCode('');
        toast({ title: 'Two-factor authentication disabled', tone: 'success' });
      },
      onError,
    });
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 'var(--text-md)' }}>Two-factor authentication (TOTP)</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            Protect your account with an authenticator app (Google Authenticator, 1Password, Authy…).
          </p>
        </div>
        <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>
      </div>

      {!enabled && !provisioning && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Button variant="primary" onClick={startSetup} loading={setup.isPending}>
            Enable two-factor authentication
          </Button>
        </div>
      )}

      {provisioning && (
        <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            Scan this QR code in your authenticator app, then enter the 6-digit code it shows.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center' }}>
            <img src={provisioning.qr_data_url} alt="MFA QR code" width={160} height={160} style={{ borderRadius: 'var(--radius-md)' }} />
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                Can’t scan? Enter this key manually:
              </p>
              <code className="mono" style={{ wordBreak: 'break-all' }}>{provisioning.secret}</code>
            </div>
          </div>
          <FormField label="Authentication code">
            <Input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
          </FormField>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="primary" onClick={confirmEnable} loading={enable.isPending} disabled={code.trim() === ''}>
              Verify & enable
            </Button>
            <Button variant="tertiary" onClick={() => setProvisioning(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {enabled && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Button variant="destructive" onClick={() => setDisableOpen(true)}>
            Disable two-factor authentication
          </Button>
        </div>
      )}

      {/* Recovery codes — shown ONCE after enabling. */}
      <Modal open={recoveryCodes !== null} onOpenChange={(o) => !o && setRecoveryCodes(null)} title="Save your recovery codes">
        <Banner tone="warning" title="These are shown only once">
          Store these somewhere safe. Each code can be used once to sign in if you lose your authenticator.
        </Banner>
        <div
          className="mono"
          style={{
            marginTop: 'var(--space-3)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {(recoveryCodes ?? []).map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
          <Button
            variant="secondary"
            onClick={() => {
              navigator.clipboard?.writeText((recoveryCodes ?? []).join('\n')).catch(() => {});
              toast({ title: 'Copied', tone: 'success' });
            }}
          >
            Copy codes
          </Button>
          <Button variant="primary" onClick={() => setRecoveryCodes(null)}>
            I’ve saved them
          </Button>
        </div>
      </Modal>

      {/* Disable — requires a current code. */}
      <Modal open={disableOpen} onOpenChange={(o) => !o && setDisableOpen(false)} title="Disable two-factor authentication">
        <p style={{ margin: '0 0 var(--space-3)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          Enter a current 6-digit code (or a recovery code) to confirm.
        </p>
        <FormField label="Authentication code">
          <Input inputMode="numeric" placeholder="123456" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} />
        </FormField>
        <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <Button variant="tertiary" onClick={() => setDisableOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDisable} loading={disable.isPending} disabled={disableCode.trim() === ''}>
            Disable
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
