/**
 * Invariant #3 — the client statement / invoice are priced SOLELY from client_billing_rates; ZERO
 * code path reads the commission_* tables or the engine (the prior system's core defect). Proven
 * three ways: (a) structural (source contains no commission delegate/import), (b) behavioral (a
 * Prisma mock whose commission delegates THROW if touched still generates fine), (c) equivalence
 * (invoice total == statement total, both from the billing stream). — CLAUDE §3 #3
 */
import * as fs from 'fs';
import * as path from 'path';
import { StatementService } from './statement.service';
import { InvoiceService } from './invoice.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// ── (a) Structural: the billing source must not reach into the commission stream ──────────────────
describe('Billing #3 — structural separation', () => {
  const FORBIDDEN_IMPORT = /from\s+['"]\.\.\/(engine|commission|payrun|clawback)/;
  const FORBIDDEN_DELEGATE =
    /\b(prisma|tx)\.(commissionTierConfig|commissionTier|commissionFlatRate|holdbackConfig|holdbackReleaseSetting|holdbackLedger|payRunLine|payRun|clawback)\b/;

  const sourceFiles = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

  it.each(sourceFiles)('%s imports no commission/engine module', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(src).not.toMatch(FORBIDDEN_IMPORT);
  });

  it.each(sourceFiles)('%s reads no commission_* / holdback / payrun Prisma delegate', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(src).not.toMatch(FORBIDDEN_DELEGATE);
  });

  it('StatementService deps are only cross-cutting seams (prisma, audit, sequence, fx, notification-emitter) — no engine/commission dependency', () => {
    // Arity 5: prisma, audit, the gapless-number sequence service, the FX rate source (common/fx), and the
    // notification emitter — all neutral common seams, NOT commission/engine deps. The #3 separation is
    // asserted by the source-scan above + the behavioural spec below (a commission Prisma delegate THROWS if
    // touched, yet generation succeeds). The FX seam converts the billing-stream total to CAD (#12), never
    // reads commission.
    expect(StatementService.length).toBe(5);
  });
});

/** A sequence stub — mints 1, 2, 3 … (the real one row-locks document_sequences inside the tx; tested separately). */
const seqStub = () => {
  let n = 0;
  return { next: jest.fn(async () => (n += 1)) };
};

// ── (b) Behavioral + (c) Equivalence ──────────────────────────────────────────────────────────────
const sale = (id: string, customer: string, items: { product_id: string; name: string }[]) => ({
  id,
  customer_name: customer,
  sale_date: d('2026-01-10'),
  sale_items: items.map((i) => ({ product_id: i.product_id, product: { name: i.name } })),
});
const rate = (productId: string, amount: string) => ({
  id: `r-${productId}`,
  product_id: productId,
  effective_from: d('2026-01-01'),
  effective_to: null,
  amount: { toString: () => amount },
});

/** A delegate whose every method throws — proves the billing path never touches it. */
const trap = (name: string) =>
  new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(`commission stream touched during billing: ${name}`);
      },
    },
  );

function makePrisma() {
  const tx = {
    clientStatement: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'stmt', lines: data.lines.create })),
      update: jest.fn(),
    },
    clientStatementLine: { deleteMany: jest.fn() },
    clientInvoice: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'inv', ...data })),
      update: jest.fn(),
    },
  };
  const prisma = {
    client: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', client_code: 'VF', currency: 'CAD' }) },
    payPeriod: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'P1',
        period_number: 3,
        start_date: d('2026-01-01'),
        end_date: d('2026-01-31'),
      }),
    },
    sale: {
      findMany: jest.fn().mockResolvedValue([
        sale('s1', 'Jane', [
          { product_id: 'int', name: 'Internet' },
          { product_id: 'tv', name: 'TV' },
        ]),
      ]),
    },
    clientBillingRate: {
      findMany: jest.fn().mockResolvedValue([rate('int', '60.00'), rate('tv', '25.00')]),
    },
    // The commission stream — every access throws.
    commissionTierConfig: trap('commissionTierConfig'),
    commissionFlatRate: trap('commissionFlatRate'),
    holdbackConfig: trap('holdbackConfig'),
    payRunLine: trap('payRunLine'),
    clawback: trap('clawback'),
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { prisma, audit };
}

describe('Billing #3 — behavioral + equivalence', () => {
  it('statement generation reads client_billing_rates and NEVER the commission stream', async () => {
    const { prisma, audit } = makePrisma();
    const fx = { getRateToCad: jest.fn().mockResolvedValue(null), isAutoEnabled: jest.fn() };
    const service = new StatementService(prisma as never, audit as never, seqStub() as never, fx as never, { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() } as never);
    await expect(service.generate('c1', 'P1', 'admin')).resolves.toBeDefined();
    expect(prisma.clientBillingRate.findMany).toHaveBeenCalled(); // billing stream IS used
    // (commission traps would have thrown if touched; success already proves they weren't.)
  });

  it('invoice total_commission == statement total_amount (both from the billing stream)', async () => {
    const { prisma, audit } = makePrisma();
    const fx = { getRateToCad: jest.fn().mockResolvedValue(null), isAutoEnabled: jest.fn() };
    const statements = new StatementService(prisma as never, audit as never, seqStub() as never, fx as never, { emit: jest.fn(), emitMany: jest.fn(), emitRole: jest.fn() } as never);
    const invoices = new InvoiceService(prisma as never, audit as never, seqStub() as never, statements);

    const stmt = (await statements.generate('c1', 'P1', 'admin')) as unknown as {
      lines: { line_total: string }[];
    };
    const stmtTotal = stmt.lines.reduce((s, l) => s + Number(l.line_total), 0).toFixed(2);

    const inv = (await invoices.generate('c1', 'P1', 'admin')) as unknown as {
      total_commission: string;
    };
    expect(inv.total_commission).toBe('85.00');
    expect(inv.total_commission).toBe(stmtTotal); // structurally identical (#3-safe)
  });
});
