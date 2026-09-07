/**
 * Bulk statement generation (packet 06) — issue every active client's statement for one billing week.
 *
 * The three properties that matter are all about what happens when something goes WRONG, because the
 * normal case is a partial run: an operator fixing one missing rate must not lose the other statements.
 *
 *   1. a failing client fails ALONE                (per-client transaction)
 *   2. an already-issued client is SKIPPED         (re-running never renumbers or duplicates)
 *   3. numbering stays gapless and unique          (#2 — the packet calls this the real risk)
 *
 * FX is asserted to freeze PER DOCUMENT (#12): each client resolves its own rate for its own currency,
 * and there is deliberately no batch-level override to spread one rate across differing currencies.
 */
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { StatementService } from './statement.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** A gapless minting stub — the real SequenceService row-locks `document_sequences` inside the tx. */
const seqStub = () => {
  let n = 400;
  return { next: jest.fn(async () => (n += 1)) };
};

type ClientRow = { id: string; client_code: string; name: string; currency?: string };

/**
 * Harness for the BULK path. `generate` is stubbed per client so each test controls success/failure
 * precisely — the pricing itself is covered exhaustively by `billing.service.spec.ts`.
 */
function make(opts: {
  clients: ClientRow[];
  alreadyIssued?: { client_id: string; statement_number: number | null }[];
  failFor?: Record<string, Error>;
  period?: { id: string; period_number: number } | null;
}) {
  const period = opts.period === undefined ? { id: 'B1', period_number: 17, start_date: d('2026-04-20'), end_date: d('2026-04-26') } : opts.period;
  const prisma = {
    billingPeriod: { findUnique: jest.fn().mockResolvedValue(period) },
    client: { findMany: jest.fn().mockResolvedValue(opts.clients) },
    clientStatement: { findMany: jest.fn().mockResolvedValue(opts.alreadyIssued ?? []) },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const sequence = seqStub();
  const fx = { getRateToCad: jest.fn().mockResolvedValue(null), isAutoEnabled: jest.fn().mockReturnValue(false) };
  const service = new StatementService(
    prisma as never,
    audit as never,
    sequence as never,
    fx as never,
    { resolve: jest.fn().mockResolvedValue({ id: null, columns: [] }) } as never,
    { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() } as never,
  );

  // Stub the per-client issue: mint from the SAME sequence so numbering assertions are meaningful.
  const generate = jest
    .spyOn(service, 'generate')
    .mockImplementation(async (clientId: string) => {
      const failure = opts.failFor?.[clientId];
      if (failure) throw failure;
      return { id: `stmt-${clientId}`, statement_number: await sequence.next() } as never;
    });

  return { service, prisma, audit, generate, sequence };
}

const unpricedError = () =>
  new UnprocessableEntityException({
    message: 'cannot generate: some sold products have no effective client_billing_rate',
    unpriced: [{ product_id: 'p9', product_name: 'Fibre 1gig', sale_date: '2026-04-21' }],
  });

const CLIENTS: ClientRow[] = [
  { id: 'c-vf', client_code: 'VF', name: 'Valley Fiber' },
  { id: 'c-rf', client_code: 'RF', name: 'RF Now' },
  { id: 'c-cti', client_code: 'CTI', name: 'CTI' },
];

describe('StatementService.generateAllForPeriod', () => {
  it('issues one statement per active client and reports them', async () => {
    const { service, generate } = make({ clients: CLIENTS });
    const result = await service.generateAllForPeriod('B1', 'admin-1');

    expect(generate).toHaveBeenCalledTimes(3);
    expect(result.generated.map((g) => g.client_code)).toEqual(['VF', 'RF', 'CTI']);
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(result.total_clients).toBe(3);
    expect(result.period_number).toBe(17);
  });

  // The property the whole packet exists for.
  it('one client with an unpriced product fails ALONE — the rest still issue', async () => {
    const { service } = make({ clients: CLIENTS, failFor: { 'c-rf': unpricedError() } });
    const result = await service.generateAllForPeriod('B1', 'admin-1');

    expect(result.generated.map((g) => g.client_code)).toEqual(['VF', 'CTI']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].client_code).toBe('RF');
  });

  it('carries the structured unpriced[] detail through, so the UI can link to the fix', async () => {
    const { service } = make({ clients: CLIENTS, failFor: { 'c-rf': unpricedError() } });
    const { failed } = await service.generateAllForPeriod('B1', 'admin-1');

    expect(failed[0].message).toContain('no effective client_billing_rate');
    expect(failed[0].unpriced).toEqual([
      { product_id: 'p9', product_name: 'Fibre 1gig', sale_date: '2026-04-21' },
    ]);
  });

  it('an unexpected (non-422) failure is still isolated and reported', async () => {
    const { service } = make({ clients: CLIENTS, failFor: { 'c-cti': new Error('connection reset') } });
    const result = await service.generateAllForPeriod('B1', 'admin-1');

    expect(result.generated).toHaveLength(2);
    expect(result.failed[0]).toMatchObject({ client_code: 'CTI', message: 'connection reset' });
    expect(result.failed[0].unpriced).toBeUndefined();
  });

  // Re-running must be safe: bulk generation is NOT a bulk re-issue.
  it('skips a client that already holds a current statement — never renumbers or duplicates', async () => {
    const { service, generate } = make({
      clients: CLIENTS,
      alreadyIssued: [{ client_id: 'c-vf', statement_number: 405 }],
    });
    const result = await service.generateAllForPeriod('B1', 'admin-1');

    expect(generate).not.toHaveBeenCalledWith('c-vf', expect.anything(), expect.anything());
    expect(result.skipped).toEqual([{ client_id: 'c-vf', client_code: 'VF', statement_number: 405 }]);
    expect(result.generated.map((g) => g.client_code)).toEqual(['RF', 'CTI']);
  });

  it('a second run issues nothing at all — every client is skipped', async () => {
    const { service, generate } = make({
      clients: CLIENTS,
      alreadyIssued: CLIENTS.map((c, i) => ({ client_id: c.id, statement_number: 400 + i })),
    });
    const result = await service.generateAllForPeriod('B1', 'admin-1');

    expect(generate).not.toHaveBeenCalled();
    expect(result.generated).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
  });

  // A legacy row predates gapless numbering and is immutable, so it was never back-filled. The client is
  // still correctly skipped — we simply cannot name the number.
  it('skips a legacy statement with no number, without crashing', async () => {
    const { service } = make({
      clients: CLIENTS,
      alreadyIssued: [{ client_id: 'c-rf', statement_number: null }],
    });
    const result = await service.generateAllForPeriod('B1', 'admin-1');

    expect(result.skipped).toEqual([{ client_id: 'c-rf', client_code: 'RF', statement_number: null }]);
    expect(result.generated.map((g) => g.client_code)).toEqual(['VF', 'CTI']);
  });

  // #2 — the risk the packet singles out.
  it('numbering is unique and gapless across the batch, in issue order', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      client_code: `C${String(i).padStart(2, '0')}`,
      name: `Client ${i}`,
    }));
    const { service } = make({ clients: many });
    const { generated } = await service.generateAllForPeriod('B1', 'admin-1');

    const numbers = generated.map((g) => g.statement_number);
    expect(numbers).toHaveLength(20);
    expect(new Set(numbers).size).toBe(20); // no duplicates
    // Gapless + ascending: each is exactly one more than the last.
    expect(numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1)).toBe(true);
  });

  it('a mid-batch failure does not consume or skip a number', async () => {
    const { service } = make({ clients: CLIENTS, failFor: { 'c-rf': unpricedError() } });
    const { generated } = await service.generateAllForPeriod('B1', 'admin-1');

    const numbers = generated.map((g) => g.statement_number);
    expect(numbers[1]).toBe(numbers[0] + 1); // VF then CTI — RF burned nothing
  });

  it('404s an unknown billing period rather than issuing anything', async () => {
    const { service, generate } = make({ clients: CLIENTS, period: null });
    await expect(service.generateAllForPeriod('nope', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(generate).not.toHaveBeenCalled();
  });

  it('considers ACTIVE clients only', async () => {
    const { service, prisma } = make({ clients: CLIENTS });
    await service.generateAllForPeriod('B1', 'admin-1');
    expect(prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { is_active: true } }),
    );
  });

  // #12 — one rate must never be spread across clients billing in different currencies.
  it('takes NO batch-level FX override: each client freezes its own rate at its own issue', async () => {
    const { service, generate } = make({ clients: CLIENTS });
    await service.generateAllForPeriod('B1', 'admin-1');

    // generate(clientId, periodId, actorId) — a 4th (fx override) argument is never passed.
    for (const call of generate.mock.calls) {
      expect(call).toHaveLength(3);
      expect(call[3]).toBeUndefined();
    }
  });

  it('audits the batch once, recording every outcome', async () => {
    const { service, audit } = make({ clients: CLIENTS, failFor: { 'c-cti': unpricedError() } });
    await service.generateAllForPeriod('B1', 'admin-1');

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log.mock.calls[0][0]).toMatchObject({
      actorId: 'admin-1',
      entityType: 'client_statements',
      after: expect.objectContaining({ bulk: true, generated: 2, skipped: 0, failed: 1 }),
    });
  });
});
