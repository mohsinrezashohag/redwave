/**
 * PeriodConfigService — the FORWARD-ONLY guard, which is the whole reason configurable calendars are safe.
 *
 * A finalized pay run and an issued statement or invoice are immutable and gapless-numbered (#2/#8).
 * Moving a period boundary underneath one does not throw — the numbers simply stop reconciling, quietly.
 * So these tests are mostly about REFUSAL: what regeneration declines to touch, and whether it says why.
 *
 * Per §14 rule 10: if one of these fails, an invariant broke — fix the code, not the spec.
 */
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PeriodConfigService } from './period-config.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

/**
 * Regeneration starts from the period containing TODAY, so a fixture that hard-codes "period 1" tests
 * nothing once real time moves past it. These mocks instead answer from the range the service actually
 * asked for, which keeps the tests true on any date.
 */
function make(opts: {
  configs?: unknown[];
  /** Attach a finalized pay run to the FIRST period in whatever range is queried. */
  blockPayWith?: { id: string; status: string };
  /** Attach an issued statement/invoice to the FIRST billing period in range. */
  blockBillingWith?: { statement_number?: number; invoice_number?: number };
  statements?: unknown[];
} = {}) {
  const firstOf = (args: { where?: { period_number?: { in?: number[] } } }): number | undefined =>
    args?.where?.period_number?.in?.[0];
  const tx = {
    payPeriod: { upsert: jest.fn() },
    billingPeriod: { upsert: jest.fn() },
  };
  const prisma = {
    periodConfig: {
      findMany: jest.fn().mockResolvedValue(opts.configs ?? []),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'cfg-1', ...data }),
      ),
    },
    payPeriod: {
      findMany: jest.fn().mockImplementation((args) => {
        const n = firstOf(args);
        if (!opts.blockPayWith || n === undefined) return Promise.resolve([]);
        return Promise.resolve([{ period_number: n, pay_runs: [opts.blockPayWith] }]);
      }),
      findUnique: jest.fn().mockResolvedValue({ start_date: d('2026-01-04'), end_date: d('2026-01-17') }),
    },
    billingPeriod: {
      findMany: jest.fn().mockImplementation((args) => {
        const n = firstOf(args);
        if (!opts.blockBillingWith || n === undefined) return Promise.resolve([]);
        const b = opts.blockBillingWith;
        return Promise.resolve([
          {
            period_number: n,
            client_statements: b.statement_number ? [{ statement_number: b.statement_number }] : [],
            client_invoices: b.invoice_number ? [{ invoice_number: b.invoice_number }] : [],
          },
        ]);
      }),
    },
    clientStatement: { findMany: jest.fn().mockResolvedValue(opts.statements ?? []) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new PeriodConfigService(prisma as never, audit as never), prisma, audit, tx };
}

const user = { id: 'admin-1' } as never;

describe('PeriodConfigService.set — recording a shape changes nothing on its own', () => {
  it('persists the shape without touching any period', async () => {
    const { service, prisma, tx } = make();
    await service.set(
      { kind: 'pay', anchor_date: '2026-01-04', length_days: 7, payday_offset_days: 5, effective_from: '2026-10-01' },
      user,
    );
    expect(prisma.periodConfig.create).toHaveBeenCalled();
    // The destructive-looking step is regeneration, and it is separate on purpose.
    expect(tx.payPeriod.upsert).not.toHaveBeenCalled();
  });

  it('rejects a NEGATIVE payday offset — a rep is never paid before the period closes', async () => {
    const { service } = make();
    await expect(
      service.set(
        { kind: 'pay', anchor_date: '2026-01-04', length_days: 14, payday_offset_days: -1, effective_from: '2026-10-01' },
        user,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  // §14 rule 1 — a bill is what the client owes, not what a rep is paid.
  it('rejects a payday offset on a BILLING calendar rather than silently ignoring it', async () => {
    const { service } = make();
    await expect(
      service.set(
        { kind: 'billing', anchor_date: '2026-01-05', length_days: 7, payday_offset_days: 3, effective_from: '2026-10-01' },
        user,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a zero-length cycle', async () => {
    const { service } = make();
    await expect(
      service.set({ kind: 'pay', anchor_date: '2026-01-04', length_days: 0, effective_from: '2026-10-01' }, user),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('PeriodConfigService.shapeFor — falls back to genesis', () => {
  // The system worked before this table existed and must keep working with it empty.
  it('returns the seeded shape when no config row exists', async () => {
    const { service } = make({ configs: [] });
    expect(await service.shapeFor('pay')).toEqual({
      anchorDate: '2026-01-04',
      lengthDays: 14,
      paydayOffsetDays: 13,
    });
    expect(await service.shapeFor('billing')).toEqual({
      anchorDate: '2026-01-05',
      lengthDays: 7,
      paydayOffsetDays: null,
    });
  });

  it('uses a configured row once one is in force', async () => {
    const { service } = make({
      configs: [
        {
          kind: 'pay',
          anchor_date: d('2026-01-04'),
          length_days: 7,
          payday_offset_days: 5,
          effective_from: d('2020-01-01'),
          effective_to: null,
        },
      ],
    });
    expect(await service.shapeFor('pay')).toEqual({
      anchorDate: '2026-01-04',
      lengthDays: 7,
      paydayOffsetDays: 5,
    });
  });
});

describe('PeriodConfigService — FORWARD-ONLY: what regeneration refuses', () => {
  // The property the entire packet rests on.
  it('refuses when a period in range has a FINALIZED pay run, and names the run', async () => {
    const { service } = make({ blockPayWith: { id: 'run-abc', status: 'finalized' } });
    const plan = await service.previewRegeneration('pay', 5);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0].reason).toContain('run-abc');
    expect(plan.blocked[0].reason).toContain('finalized');
  });

  it('a DRAFT run does not block — nothing is frozen until finalize', async () => {
    const { service } = make({ blockPayWith: { id: 'run-draft', status: 'draft' } });
    expect((await service.previewRegeneration('pay', 5)).blocked).toEqual([]);
  });

  it('refuses a billing week carrying an ISSUED statement, and names it', async () => {
    const { service } = make({ blockBillingWith: { statement_number: 412 } });
    const plan = await service.previewRegeneration('billing', 10);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0].reason).toContain('412');
  });

  it('refuses a billing week carrying an ISSUED invoice', async () => {
    const { service } = make({ blockBillingWith: { invoice_number: 77 } });
    expect((await service.previewRegeneration('billing', 10)).blocked[0].reason).toContain('77');
  });

  // A partial application would leave the calendar half-moved — harder to reason about than a refusal.
  it('regenerate THROWS and writes nothing when anything in range is frozen', async () => {
    const { service, tx } = make({ blockPayWith: { id: 'run-abc', status: 'finalized' } });
    await expect(service.regenerate('pay', 5, user)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.payPeriod.upsert).not.toHaveBeenCalled();
  });

  it('writes when nothing is frozen — and UPSERTS rather than deleting', async () => {
    const { service, tx } = make();
    await service.regenerate('pay', 3, user);
    expect(tx.payPeriod.upsert).toHaveBeenCalledTimes(3);
    // Existing rows are referenced by frozen documents; deleting and re-creating would orphan them.
    const call = tx.payPeriod.upsert.mock.calls[0][0] as { where: unknown; update: unknown; create: unknown };
    expect(call.where).toEqual({ period_number: expect.any(Number) });
    expect(call.update).toBeDefined();
  });

  it('a pay regeneration never writes billing periods, and vice versa (§14 rule 1)', async () => {
    const pay = make();
    await pay.service.regenerate('pay', 2, user);
    expect(pay.tx.billingPeriod.upsert).not.toHaveBeenCalled();

    const billing = make();
    await billing.service.regenerate('billing', 2, user);
    expect(billing.tx.payPeriod.upsert).not.toHaveBeenCalled();
  });

  it('rejects an absurd count rather than generating 10,000 periods', async () => {
    const { service } = make();
    await expect(service.previewRegeneration('pay', 0)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.previewRegeneration('pay', 5000)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  // Preview and apply share one planner, so what an admin is shown is what would happen.
  it('preview and apply agree on the plan', async () => {
    const { service } = make();
    const preview = await service.previewRegeneration('pay', 4);
    const applied = await service.regenerate('pay', 4, user);
    expect(applied.periods).toEqual(preview.periods);
    expect(applied.from_period).toBe(preview.from_period);
  });

  it('audits the regeneration with the shape it applied', async () => {
    const { service, audit } = make();
    await service.regenerate('pay', 2, user);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        after: expect.objectContaining({ regenerated: true, kind: 'pay', count: 2 }),
      }),
    );
  });
});

describe('PeriodConfigService.calendarOverlap — the two-calendar boundary, made visible', () => {
  it('reports the billing weeks that touch a pay period', async () => {
    const { service } = make();
    const overlap = await service.calendarOverlap(1);
    expect(overlap.pay_start).toBe('2026-01-04');
    expect(overlap.billing_periods.length).toBeGreaterThan(0);
    // At least one week crosses the boundary — that is the point of surfacing it.
    expect(overlap.billing_periods.some((b) => !b.fully_inside)).toBe(true);
  });

  it('404s an unknown pay period', async () => {
    const { service, prisma } = make();
    prisma.payPeriod.findUnique.mockResolvedValue(null);
    await expect(service.calendarOverlap(99)).rejects.toBeInstanceOf(NotFoundException);
  });
});
