import type { ConfigService } from '@nestjs/config';
import { MailerService } from './mailer.service';

const config = (env: Record<string, string | undefined>): ConfigService =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

/** Spy on the low-level send so no Resend client / network is involved. */
function makeService(env: Record<string, string | undefined>) {
  const service = new MailerService(config(env));
  const send = jest.spyOn(service, 'send').mockResolvedValue(undefined);
  return { service, send };
}

describe('MailerService — PRODUCTION fail-safe (APP_BASE_URL unset → link-bearing emails are NOT sent)', () => {
  const prodUnset = { NODE_ENV: 'production' };

  it('refuses sendPasswordReset / sendInvite / sendTempPassword (no localhost link ever reaches a user)', async () => {
    const { service, send } = makeService(prodUnset);
    await service.sendPasswordReset('u@x.co', 'U', 'tok');
    await service.sendInvite('u@x.co', 'U', 'tok');
    await service.sendTempPassword('u@x.co', 'U', 'Temp123!');
    expect(send).not.toHaveBeenCalled();
  });

  it('does not throw (best-effort — forgot-password stays non-enumerating, user-create unbroken)', async () => {
    const { service } = makeService(prodUnset);
    await expect(service.sendPasswordReset('u@x.co', 'U', 'tok')).resolves.toBeUndefined();
  });
});

describe('MailerService — links built from APP_BASE_URL (normalized, single source)', () => {
  const prodSet = { NODE_ENV: 'production', APP_BASE_URL: 'https://app.redwavemarketing.ca/' };

  it('reset email links to <base>/reset-password?token=… (no trailing-slash doubling, no localhost)', async () => {
    const { service, send } = makeService(prodSet);
    await service.sendPasswordReset('u@x.co', 'U', 'tok-123');
    const html = send.mock.calls[0][2];
    expect(html).toContain('https://app.redwavemarketing.ca/reset-password?token=tok-123');
    expect(html).not.toContain('localhost');
    expect(html).not.toContain('.ca//');
  });

  it('invite email links to /set-password; temp-password email links to /login', async () => {
    const { service, send } = makeService(prodSet);
    await service.sendInvite('u@x.co', 'U', 'tok-9');
    expect(send.mock.calls[0][2]).toContain('https://app.redwavemarketing.ca/set-password?token=tok-9');

    await service.sendTempPassword('u@x.co', 'U', 'Temp123!');
    expect(send.mock.calls[1][2]).toContain('https://app.redwavemarketing.ca/login');
  });

  it('legacy APP_URL still works (deprecated alias)', async () => {
    const { service, send } = makeService({ NODE_ENV: 'production', APP_URL: 'https://app.redwavemarketing.ca' });
    await service.sendPasswordReset('u@x.co', 'U', 't');
    expect(send.mock.calls[0][2]).toContain('https://app.redwavemarketing.ca/reset-password?token=t');
  });

  it('dev with nothing set → the localhost default (zero local setup)', async () => {
    const { service, send } = makeService({});
    await service.sendPasswordReset('u@x.co', 'U', 't');
    expect(send.mock.calls[0][2]).toContain('http://localhost:5173/reset-password?token=t');
  });
});
