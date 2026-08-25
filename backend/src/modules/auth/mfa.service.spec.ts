import { UnauthorizedException } from '@nestjs/common';
import { authenticator } from 'otplib';
import { MfaService } from './mfa.service';

// `enable()` bcrypt-hashes TEN recovery codes at cost 10, and the verify tests then compare against those
// hashes — ~3.5–4.5 s of deliberate work on an idle machine. Jest's DEFAULT timeout is 5 s (there is no
// `testTimeout` in the jest config), so under a full parallel suite those two tests crossed it and failed
// intermittently while passing standalone. That is the "mfa.service.spec flake" — a timeout against real
// crypto cost, NOT a TOTP window roll. Raising the budget here keeps the real bcrypt cost under test
// instead of weakening it to fit an arbitrary limit. — docs/build-log.md (UAT-file audit fixes)
jest.setTimeout(30_000);

type MfaRow = { user_id: string; secret: string; enabled: boolean; confirmed_at: Date | null };
type RecoveryRow = { id: string; user_id: string; code_hash: string; used_at: Date | null };

function make(opts: { enforced?: boolean; roleRequires?: boolean } = {}) {
  let mfaRow: MfaRow | null = null;
  let recovery: RecoveryRow[] = [];
  let rseq = 0;

  const prisma = {
    userMfa: {
      findUnique: jest.fn(async () => mfaRow),
      upsert: jest.fn(async ({ create, update }: { create?: Partial<MfaRow>; update?: Partial<MfaRow> }) => {
        mfaRow = mfaRow
          ? { ...mfaRow, ...update }
          : { user_id: 'u1', secret: '', enabled: false, confirmed_at: null, ...create };
        return mfaRow;
      }),
      update: jest.fn(async ({ data }: { data: Partial<MfaRow> }) => {
        mfaRow = { ...(mfaRow as MfaRow), ...data };
        return mfaRow;
      }),
      deleteMany: jest.fn(async () => {
        mfaRow = null;
        return { count: 1 };
      }),
    },
    mfaRecoveryCode: {
      createMany: jest.fn(async ({ data }: { data: { user_id: string; code_hash: string }[] }) => {
        recovery = data.map((d) => ({ id: `r-${(rseq += 1)}`, used_at: null, ...d }));
        return { count: data.length };
      }),
      deleteMany: jest.fn(async () => {
        recovery = [];
        return { count: 0 };
      }),
      findMany: jest.fn(async () => recovery.filter((r) => !r.used_at)),
      update: jest.fn(async ({ where: { id }, data }: { where: { id: string }; data: { used_at: Date } }) => {
        const row = recovery.find((r) => r.id === id)!;
        row.used_at = data.used_at;
        return row;
      }),
    },
    userRole: { findFirst: jest.fn(async () => (opts.roleRequires ? { role_id: 'r1' } : null)) },
    securitySetting: { findFirst: jest.fn(async () => ({ mfa_enforced: opts.enforced ?? false })) },
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn((_k: string, d?: string) => d) };
  const service = new MfaService(prisma as never, audit as never, config as never);
  return { service, getMfa: () => mfaRow, getRecovery: () => recovery };
}

describe('MfaService.loginGate — policy (AUTH MFA)', () => {
  it("→ 'required' when the user has MFA enabled", async () => {
    const { service, getMfa } = make();
    await service.setup('u1', 'u@x.co');
    await service.enable('u1', authenticator.generate(getMfa()!.secret));
    expect(await service.loginGate('u1')).toBe('required');
  });

  it("→ 'none' when not enrolled and enforcement is off", async () => {
    const { service } = make({ enforced: false, roleRequires: true });
    expect(await service.loginGate('u1')).toBe('none');
  });

  it("→ 'enrollment_required' when enforced + a required role + not enrolled", async () => {
    const { service } = make({ enforced: true, roleRequires: true });
    expect(await service.loginGate('u1')).toBe('enrollment_required');
  });

  it("→ 'none' when enforced but no required role", async () => {
    const { service } = make({ enforced: true, roleRequires: false });
    expect(await service.loginGate('u1')).toBe('none');
  });
});

describe('MfaService enroll → verify (TOTP + recovery codes)', () => {
  it('setup → enable returns 10 recovery codes and turns MFA on', async () => {
    const { service, getMfa } = make();
    const setup = await service.setup('u1', 'u@x.co');
    expect(setup.otpauth_url).toContain('otpauth://');
    expect(setup.qr_data_url).toContain('data:image');
    const { recovery_codes } = await service.enable('u1', authenticator.generate(getMfa()!.secret));
    expect(recovery_codes).toHaveLength(10);
    expect(getMfa()!.enabled).toBe(true);
  });

  it('rejects enable with a wrong code', async () => {
    const { service } = make();
    await service.setup('u1', 'u@x.co');
    await expect(service.enable('u1', '000000')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('verifyChallenge accepts a valid TOTP', async () => {
    const { service, getMfa } = make();
    await service.setup('u1', 'u@x.co');
    await service.enable('u1', authenticator.generate(getMfa()!.secret));
    await expect(service.verifyChallenge('u1', authenticator.generate(getMfa()!.secret))).resolves.toBeUndefined();
  });

  it('recovery codes are single-use', async () => {
    const { service, getMfa } = make();
    await service.setup('u1', 'u@x.co');
    const { recovery_codes } = await service.enable('u1', authenticator.generate(getMfa()!.secret));
    const code = recovery_codes[0];
    await expect(service.verifyChallenge('u1', code)).resolves.toBeUndefined(); // first use OK
    await expect(service.verifyChallenge('u1', code)).rejects.toBeInstanceOf(UnauthorizedException); // reuse rejected
  });

  it('verifyChallenge rejects a bad code', async () => {
    const { service, getMfa } = make();
    await service.setup('u1', 'u@x.co');
    await service.enable('u1', authenticator.generate(getMfa()!.secret));
    await expect(service.verifyChallenge('u1', 'ZZZZ-ZZZZ-ZZZZ')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
