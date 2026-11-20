/**
 * Money-path specs for the DATE-RANGE commission report (client decision 2026-11-16).
 *
 * Runs PayRunService against a small STATEFUL in-memory Prisma fake and the REAL CommissionEngineService, so
 * the assertions are about what ends up stored: frozen snapshots (#2), sale statuses (§16), lines, and the
 * atomic rollback of a failed finalize (#8). `sale_date` governs which sales a report covers (#7).
 */
import { ConflictException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PayRunService } from './pay-run.service';
import { CommissionEngineService } from '../engine/commission-engine.service';
import { ZeroClawbackTotalProvider } from './seams/clawback-total.provider';
import { AuthUser } from '../../common/rbac/auth-user.type';

const admin: AuthUser = {
  id: 'admin-1',
  email: 'a@x.co',
  full_name: 'Admin',
  status: 'active',
  roleNames: [],
  isSuperAdmin: true,
  permissions: new Set(),
  repId: null,
};

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

type Row = Record<string, unknown>;

/** Minimal Prisma `where` matcher for the filters PayRunService uses. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Row[]).every((w) => matches(row, w));
    if (key === 'pay_run_lines') {
      const repId = ((cond as Row).some as Row).rep_id;
      return (row.__lines as Row[]).some((l) => l.rep_id === repId);
    }
    const v = row[key];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (typeof cond === 'object') {
      const c = cond as Row;
      if ('in' in c && !(c.in as unknown[]).includes(v)) return false;
      if ('not' in c && (c.not === null ? v === null || v === undefined : v === c.not)) return false;
      if ('gte' in c && !((v as Date).getTime() >= (c.gte as Date).getTime())) return false;
      if ('lte' in c && !((v as Date).getTime() <= (c.lte as Date).getTime())) return false;
      return true;
    }
    return v === cond;
  });
}

function build(opts: { beforeClaim?: (state: { sales: { id: string; status: string }[] }) => void } = {}) {
  const period = { id: 'P22', period_number: 22, start_date: d('2026-11-01'), end_date: d('2026-11-14'), status: 'open' };
  const reps = [
    { id: 'R1', rep_code: 'RW-0001', external_code: 'Redwave1', full_name: 'Rep One', user_id: null },
    { id: 'R2', rep_code: 'RW-0002', external_code: null, full_name: 'Rep Two', user_id: null },
  ];
  const clients = [
    { id: 'VF', client_code: 'VF', name: 'Valley Fiber' },
    { id: 'RF', client_code: 'RF', name: 'RF Now' },
  ];
  const item = (id: string, product_type: string, counts_toward_tally = true) => ({
    id,
    product_type,
    counts_toward_tally,
    product_id: null,
    product: null,
    rate_applied: null as string | null,
    commission_paid: null as string | null,
    incentive_amount: null as string | null,
    incentive_id: null as string | null,
  });
  const sale = (id: string, rep_id: string, client_id: string, date: string, status: string, items: ReturnType<typeof item>[]) => ({
    id,
    sale_code: `${date}-${client_id}-${id}`,
    rep_id,
    client_id,
    sale_date: d(date),
    status,
    pay_run_id: null as string | null,
    customer_name: `Customer ${id}`,
    street: null,
    city: null,
    province_state: null,
    postal_code: null,
    is_greenfield: items.some((i) => i.product_type === 'internet' && !i.counts_toward_tally),
    rep: reps.find((r) => r.id === rep_id)!,
    client: clients.find((c) => c.id === client_id)!,
    sale_items: items,
  });

  const state = {
    period,
    sales: [
      sale('s1', 'R1', 'VF', '2026-11-03', 'validated', [item('i1', 'internet'), item('i2', 'tv')]), // 110 + 30
      sale('s2', 'R1', 'RF', '2026-11-10', 'validated', [item('i3', 'internet', false)]), // greenfield 100 (#9)
      sale('s3', 'R2', 'VF', '2026-11-05', 'validated', [item('i4', 'internet'), item('i5', 'home_phone')]), // 140
      sale('s4', 'R1', 'VF', '2026-11-20', 'validated', [item('i6', 'internet')]), // outside Nov 1–14
      sale('s5', 'R2', 'VF', '2026-11-06', 'entered', [item('i7', 'internet')]), // not validated: never paid
    ],
    runs: [] as Row[],
    lines: [] as Row[],
    payrollLines: [] as Row[],
  };
  let seq = 0;

  const withPeriod = (run: Row) => ({
    ...run,
    pay_period: run.pay_period_id === period.id ? { ...state.period } : null,
  });
  const runRows = () => state.runs.map((r) => ({ ...r, __lines: state.lines.filter((l) => l.pay_run_id === r.id) }));
  const strip = (r: Row) => {
    const { __lines, ...rest } = r;
    void __lines;
    return rest;
  };

  const db = {
    client: {
      findUnique: jest.fn(async ({ where }: { where: Row }) => clients.find((c) => c.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: { where: Row }) => clients.filter((c) => matches(c, where))),
    },
    rep: {
      findUnique: jest.fn(async ({ where }: { where: Row }) => reps.find((r) => r.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: { where: Row }) => reps.filter((r) => matches(r, where))),
    },
    payPeriod: {
      findUnique: jest.fn(async ({ where }: { where: Row }) => (where.id === period.id ? { ...state.period } : null)),
      update: jest.fn(async ({ data }: { data: Row }) => Object.assign(state.period, data)),
    },
    payRun: {
      findUnique: jest.fn(async ({ where }: { where: Row }) => {
        const run = state.runs.find((r) => r.id === where.id);
        return run ? withPeriod(run) : null;
      }),
      findFirst: jest.fn(async ({ where }: { where: Row }) => {
        const run = runRows().find((r) => matches(r, where));
        return run ? strip(run) : null;
      }),
      findMany: jest.fn(async ({ where }: { where?: Row } = {}) =>
        runRows()
          .filter((r) => matches(r, where))
          .map((r) => withPeriod(strip(r))),
      ),
      count: jest.fn(async ({ where }: { where?: Row } = {}) => runRows().filter((r) => matches(r, where)).length),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const run = {
          id: `run-${++seq}`,
          pay_period_id: null,
          date_from: null,
          date_to: null,
          client_id: null,
          rep_id: null,
          label: null,
          created_at: new Date(),
          ...data,
        };
        state.runs.push(run);
        return { ...run };
      }),
      update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const run = state.runs.find((r) => r.id === where.id)!;
        return { ...Object.assign(run, data) };
      }),
      delete: jest.fn(async ({ where }: { where: Row }) => {
        state.runs = state.runs.filter((r) => r.id !== where.id);
      }),
    },
    payRunLine: {
      findMany: jest.fn(async ({ where, include }: { where: Row; include?: Row }) =>
        state.lines
          .filter((l) => matches(l, where))
          .map((l) => (include ? { ...l, rep: reps.find((r) => r.id === l.rep_id) } : { ...l })),
      ),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        state.lines = state.lines.filter((l) => !matches(l, where));
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const line = { id: `line-${++seq}`, ...data };
        state.lines.push(line);
        return line;
      }),
    },
    sale: {
      findMany: jest.fn(async ({ where, distinct }: { where: Row; distinct?: string[] }) => {
        const rows = state.sales.filter((s) => matches(s as unknown as Row, where));
        if (distinct?.includes('rep_id')) {
          return [...new Set(rows.map((r) => r.rep_id))].map((rep_id) => ({ rep_id }));
        }
        return structuredClone(rows);
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        if (data.status === 'in_pay_run') opts.beforeClaim?.(state);
        const rows = state.sales.filter((s) => matches(s as unknown as Row, where));
        rows.forEach((s) => Object.assign(s, data));
        return { count: rows.length };
      }),
    },
    saleItem: {
      update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const it = state.sales.flatMap((s) => s.sale_items).find((i) => i.id === where.id)!;
        return Object.assign(it, data);
      }),
    },
    payrollReportLine: {
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        state.payrollLines = state.payrollLines.filter((l) => !matches(l, where));
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        state.payrollLines.push({ ...data });
        return data;
      }),
    },
  };

  // A REAL rollback: snapshot the whole state, restore it if the callback throws (#8).
  const prisma = {
    ...db,
    $transaction: jest.fn(async (cb: (tx: typeof db) => Promise<unknown>) => {
      const saved = structuredClone({ ...state, sales: state.sales.map((s) => ({ ...s, rep: null, client: null })) });
      try {
        return await cb(db);
      } catch (err) {
        Object.assign(state.period, saved.period);
        state.runs = saved.runs;
        state.lines = saved.lines;
        state.payrollLines = saved.payrollLines;
        state.sales.forEach((s, idx) => {
          const old = saved.sales[idx];
          s.status = old.status;
          s.pay_run_id = old.pay_run_id;
          s.sale_items = old.sale_items;
        });
        throw err;
      }
    }),
  };

  const expenseSeam = {
    getApprovedExpenseTotal: jest.fn(async () => new Decimal('25.00')),
    getApprovedExpenseTotalForRange: jest.fn(async () => new Decimal('12.50')),
  };
  const config = {
    getEngineConfig: jest.fn(async () => ({
      flatRates: {
        internet: new Decimal('110'),
        greenfield_internet: new Decimal('100'),
        tv: new Decimal('30'),
        home_phone: new Decimal('30'),
      },
    })),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const scope = { getRepScope: jest.fn(async () => ({ level: 'all' })) };
  const emitter = { emit: jest.fn(), emitMany: jest.fn(async () => undefined), emitRole: jest.fn() };

  const service = new PayRunService(
    prisma as never,
    audit as never,
    scope as never,
    config as never,
    new CommissionEngineService(),
    expenseSeam as never,
    new ZeroClawbackTotalProvider(),
    emitter as never,
  );
  return { service, state, prisma, expenseSeam };
}

const byRep = (lines: { rep_id: string; commission: unknown; net_payout: unknown; clawback_total: unknown }[]) =>
  Object.fromEntries(lines.map((l) => [l.rep_id, { commission: String(l.commission), net: String(l.net_payout), clawback: String(l.clawback_total) }]));

const NOV_FIRST_HALF = { date_from: '2026-11-01', date_to: '2026-11-14' };

describe('PayRunService — date-range commission report (2026-11-16)', () => {
  it('a range DRAFT computes the same commission (and net) that finalize pays', async () => {
    const { service } = build();
    const draft = await service.createDraft(NOV_FIRST_HALF, admin);
    expect(draft.kind).toBe('range');
    expect(draft.display_label).toBe('2026-11-01 to 2026-11-14');
    const draftLines = byRep(draft.lines);
    // R1: s1 (110 + 30) + s2 greenfield 100 = 240 · R2: s3 (110 + 30) = 140. s4 (Nov 20) and s5 (entered) excluded.
    expect(draftLines).toEqual({
      R1: { commission: '240.00', net: '252.50', clawback: '0.00' },
      R2: { commission: '140.00', net: '152.50', clawback: '0.00' },
    });

    const paid = await service.finalize(draft.id, admin);
    expect(paid.status).toBe('finalized');
    expect(byRep(paid.lines)).toEqual(draftLines);
  });

  it('finalize over a range freezes snapshots, marks the sales paid and does NOT mark a pay period paid', async () => {
    const { service, state, prisma } = build();
    const draft = await service.createDraft(NOV_FIRST_HALF, admin);
    await service.finalize(draft.id, admin);

    const sale = (id: string) => state.sales.find((s) => s.id === id)!;
    for (const id of ['s1', 's2', 's3']) {
      expect(sale(id)).toMatchObject({ status: 'paid', pay_run_id: draft.id });
    }
    // Snapshots frozen (#2), greenfield paid the greenfield rate (#9).
    expect(sale('s1').sale_items.map((i) => [i.rate_applied, i.commission_paid])).toEqual([
      ['110.00', '110.00'],
      ['30.00', '30.00'],
    ]);
    expect(sale('s2').sale_items[0].rate_applied).toBe('100.00');
    // Outside the range / not validated: untouched.
    expect(sale('s4')).toMatchObject({ status: 'validated', pay_run_id: null });
    expect(sale('s4').sale_items[0].rate_applied).toBeNull();
    expect(sale('s5').status).toBe('entered');
    // One payroll line per paid sale, from the same engine result.
    expect(state.payrollLines.map((l) => l.sale_id).sort()).toEqual(['s1', 's2', 's3']);
    // A range report says nothing about a whole pay period.
    expect(prisma.payPeriod.update).not.toHaveBeenCalled();
    expect(state.period.status).toBe('open');
  });

  it('re-finalize is a no-op: no second transaction, nothing re-frozen', async () => {
    const { service, state, prisma } = build();
    const draft = await service.createDraft(NOV_FIRST_HALF, admin);
    await service.finalize(draft.id, admin);
    const txCalls = prisma.$transaction.mock.calls.length;
    const before = structuredClone({ lines: state.lines, payroll: state.payrollLines });

    const again = await service.finalize(draft.id, admin);
    expect(again.status).toBe('finalized');
    expect(prisma.$transaction.mock.calls.length).toBe(txCalls);
    expect(structuredClone({ lines: state.lines, payroll: state.payrollLines })).toEqual(before);
  });

  it('an overlapping second draft after finalize contains none of the already-paid sales', async () => {
    const { service } = build();
    const first = await service.createDraft(NOV_FIRST_HALF, admin);
    await service.finalize(first.id, admin);

    const second = await service.createDraft({ date_from: '2026-11-05', date_to: '2026-11-25' }, admin);
    expect(second.id).not.toBe(first.id);
    // Only s4 (R1, Nov 20) is still validated in range.
    expect(byRep(second.lines)).toEqual({ R1: { commission: '110.00', net: '122.50', clawback: '0.00' } });

    const drill = await service.runSales(second.id, 'R1', admin);
    expect(drill.basis).toBe('estimated');
    expect(drill.sales.map((s) => s.sale_id)).toEqual(['s4']);
    expect(drill.total).toBe('110.00');
    const r2 = await service.runSales(second.id, 'R2', admin);
    expect(r2.sales).toEqual([]);
  });

  it('a claim count mismatch (sale paid by another report meanwhile) throws 409 and rolls EVERYTHING back', async () => {
    const { service, state } = build({
      // Simulate a concurrent report paying s2 between this finalize's read and its claim.
      beforeClaim: (st) => {
        const s2 = st.sales.find((s) => s.id === 's2')!;
        if (s2.status === 'validated') s2.status = 'paid';
      },
    });
    const draft = await service.createDraft(NOV_FIRST_HALF, admin);
    const linesBefore = structuredClone(state.lines);

    await expect(service.finalize(draft.id, admin)).rejects.toBeInstanceOf(ConflictException);

    expect(state.runs.find((r) => r.id === draft.id)!.status).toBe('draft');
    expect(state.sales.find((s) => s.id === 's1')).toMatchObject({ status: 'validated', pay_run_id: null });
    expect(state.sales.flatMap((s) => s.sale_items).every((i) => i.rate_applied === null)).toBe(true);
    expect(state.payrollLines).toEqual([]);
    expect(state.lines).toEqual(linesBefore);
  });

  it('applies no clawback: every line carries clawback_total 0.00', async () => {
    const { service } = build();
    const draft = await service.createDraft(NOV_FIRST_HALF, admin);
    const paid = await service.finalize(draft.id, admin);
    expect(paid.lines.every((l) => String(l.clawback_total) === '0.00')).toBe(true);
  });

  it('a one-client report covers only that client and reimburses no expenses', async () => {
    const { service, state, expenseSeam } = build();
    const draft = await service.createDraft({ ...NOV_FIRST_HALF, client_id: 'VF' }, admin);
    expect(byRep(draft.lines)).toEqual({
      R1: { commission: '140.00', net: '140.00', clawback: '0.00' },
      R2: { commission: '140.00', net: '140.00', clawback: '0.00' },
    });
    expect(expenseSeam.getApprovedExpenseTotalForRange).not.toHaveBeenCalled();
    await service.finalize(draft.id, admin);
    expect(state.sales.find((s) => s.id === 's2')!.status).toBe('validated'); // RF sale left for its own report
  });

  it('a one-rep report covers only that rep', async () => {
    const { service } = build();
    const draft = await service.createDraft({ ...NOV_FIRST_HALF, rep_id: 'R2' }, admin);
    expect(Object.keys(byRep(draft.lines))).toEqual(['R2']);
    expect(draft.scope_rep).toMatchObject({ id: 'R2', rep_code: 'RW-0002' });
  });

  it('a later all-clients report does not reimburse expense days an earlier finalized report covered', async () => {
    const { service, expenseSeam } = build();
    const first = await service.createDraft(NOV_FIRST_HALF, admin);
    await service.finalize(first.id, admin);
    expenseSeam.getApprovedExpenseTotalForRange.mockClear();

    await service.createDraft({ date_from: '2026-11-05', date_to: '2026-11-25' }, admin);
    // R1 was paid by the first report for Nov 1–14, so only Nov 15–25 is reimbursed.
    const spans = expenseSeam.getApprovedExpenseTotalForRange.mock.calls.map(
      (c) => `${(c as unknown as [string, Date, Date])[1].toISOString().slice(0, 10)}..${(c as unknown as [string, Date, Date])[2].toISOString().slice(0, 10)}`,
    );
    expect(spans).toEqual(['2026-11-15..2026-11-25']);
  });

  it('deleting a draft removes it; a paid report cannot be deleted (409)', async () => {
    const { service, state } = build();
    const draft = await service.createDraft(NOV_FIRST_HALF, admin);
    await service.deleteDraft(draft.id, admin);
    expect(state.runs).toEqual([]);
    expect(state.lines).toEqual([]);

    const again = await service.createDraft(NOV_FIRST_HALF, admin);
    await service.finalize(again.id, admin);
    await expect(service.deleteDraft(again.id, admin)).rejects.toBeInstanceOf(ConflictException);
  });

  it('the same range + client + rep refreshes its open draft instead of creating a second one', async () => {
    const { service, state } = build();
    const a = await service.createDraft(NOV_FIRST_HALF, admin);
    const b = await service.createDraft({ ...NOV_FIRST_HALF, label: 'November A' }, admin);
    expect(b.id).toBe(a.id);
    expect(b.display_label).toBe('November A');
    expect(state.runs).toHaveLength(1);
  });
});

describe('PayRunService — a LEGACY pay-period run still finalizes', () => {
  it('pays the period sales, uses the period expense seam and marks the period paid', async () => {
    const { service, state, expenseSeam } = build();
    const draft = await service.createDraft({ pay_period_id: 'P22' }, admin);
    expect(draft.kind).toBe('period');
    expect(draft.display_label).toBe('Pay period #22');

    const paid = await service.finalize(draft.id, admin);
    expect(paid.status).toBe('finalized');
    expect(byRep(paid.lines)).toEqual({
      R1: { commission: '240.00', net: '265.00', clawback: '0.00' },
      R2: { commission: '140.00', net: '165.00', clawback: '0.00' },
    });
    expect(expenseSeam.getApprovedExpenseTotal).toHaveBeenCalledWith('R1', 'P22');
    expect(expenseSeam.getApprovedExpenseTotalForRange).not.toHaveBeenCalled();
    expect(state.period.status).toBe('paid');
    expect(state.sales.filter((s) => s.status === 'paid').map((s) => s.id).sort()).toEqual(['s1', 's2', 's3']);
  });
});
