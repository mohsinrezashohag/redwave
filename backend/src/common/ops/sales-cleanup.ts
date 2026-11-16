/**
 * Pre-handover sales data cleanup (2026-11-16) — the testable core of `npm -w backend run data:cleanup`.
 *
 * Three passes, in one transaction:
 *  1. DEMO: every rep whose code starts `RW-D-` (the demo seed's reps) and everything hanging off them —
 *     sales + items, clawbacks, pay-run lines, payroll lines, statements that billed a demo sale, expenses,
 *     documents, equipment, targets. Their logins are DEACTIVATED, not deleted (audit rows point at users).
 *  2. MPU DUPLICATES: one client + MPU is one household (§14 rule 8). Each group of live sales sharing a
 *     client + MPU keeps ONE sale (the frozen one if exactly one is paid / in a pay run / clawed back, else
 *     the oldest) and the rest become `deleted`. A group with two frozen copies is only reported.
 *  3. DELETED DEBRIS: soft-deleted sales (re-import copies) are removed for good, unless something frozen
 *     still points at them (a clawback, payroll line or statement line), which are reported and kept.
 *
 * The schema has no cascades, so every child is removed before its parent. Dry run by default: the plan is
 * computed and printed, nothing is written. Never touches a frozen snapshot of a sale it keeps (#2).
 */
import { Prisma, PrismaClient } from '@prisma/client';

export const DEMO_REP_PREFIX = 'RW-D-';
const FROZEN = new Set(['paid', 'in_pay_run', 'clawed_back']);

export interface DupCandidate {
  id: string;
  client_id: string;
  mpu_id: string | null;
  sale_code: string;
  status: string;
  created_at: Date;
}

export interface DupGroup {
  key: string;
  keep: DupCandidate;
  remove: DupCandidate[];
}

export interface DupPlan {
  groups: DupGroup[];
  /** Groups with more than one frozen copy: both were paid, so a human decides (a clawback, not a delete). */
  blocked: DupCandidate[][];
}

/** PURE. Group live sales by client + MPU (case/space-insensitive) and decide which copy survives. */
export function planMpuDuplicates(sales: DupCandidate[]): DupPlan {
  const byKey = new Map<string, DupCandidate[]>();
  for (const s of sales) {
    const mpu = s.mpu_id?.trim().toLowerCase();
    if (!mpu || s.status === 'deleted') continue;
    const key = `${s.client_id}|${mpu}`;
    byKey.set(key, [...(byKey.get(key) ?? []), s]);
  }
  const plan: DupPlan = { groups: [], blocked: [] };
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const frozen = list.filter((s) => FROZEN.has(s.status));
    if (frozen.length > 1) {
      plan.blocked.push(list);
      continue;
    }
    // Oldest first; on a tie the code without a `-N` suffix (the shorter one) is the original.
    const ordered = [...list].sort(
      (a, b) =>
        a.created_at.getTime() - b.created_at.getTime() ||
        a.sale_code.length - b.sale_code.length ||
        a.sale_code.localeCompare(b.sale_code),
    );
    const keep = frozen[0] ?? ordered[0];
    plan.groups.push({ key, keep, remove: ordered.filter((s) => s.id !== keep.id) });
  }
  return plan;
}

export interface CleanupReport {
  demoReps: string[];
  demoSales: number;
  demoPayRunsRemoved: number;
  demoStatementsRemoved: number;
  demoUsersDeactivated: number;
  duplicateGroups: DupGroup[];
  duplicateBlocked: DupCandidate[][];
  purgedDeleted: number;
  keptDeleted: string[];
  /** Same rep + client + date + customer name but no MPU: listed for a manual look, never touched. */
  nameLookalikes: string[][];
}

type Tx = Prisma.TransactionClient;

/** Passes 2 and 3 skip demo sales: in a dry run pass 1 hasn't removed them yet. */
const NOT_DEMO: Prisma.SaleWhereInput = { rep: { NOT: { rep_code: { startsWith: DEMO_REP_PREFIX } } } };

async function removeSales(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.reportExportSale.deleteMany({ where: { sale_id: { in: ids } } });
  await tx.payrollReportLine.deleteMany({ where: { sale_id: { in: ids } } });
  await tx.clawback.deleteMany({ where: { sale_id: { in: ids } } });
  await tx.saleItem.deleteMany({ where: { sale_id: { in: ids } } });
  await tx.sale.deleteMany({ where: { id: { in: ids } } });
}

async function removeStatements(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.billingExport.deleteMany({ where: { statement_id: { in: ids } } });
  await tx.clientStatement.updateMany({ where: { superseded_by_id: { in: ids } }, data: { superseded_by_id: null } });
  await tx.clientStatementLine.deleteMany({ where: { statement_id: { in: ids } } });
  await tx.clientStatement.deleteMany({ where: { id: { in: ids } } });
}

/** Pass 1. Returns the counts; writes only when `write`. */
async function cleanDemo(tx: Tx, report: CleanupReport, write: boolean): Promise<void> {
  const reps = await tx.rep.findMany({
    where: { rep_code: { startsWith: DEMO_REP_PREFIX } },
    select: { id: true, rep_code: true, user_id: true },
  });
  report.demoReps = reps.map((r) => r.rep_code);
  if (reps.length === 0) return;
  const repIds = reps.map((r) => r.id);
  const sales = await tx.sale.findMany({ where: { rep_id: { in: repIds } }, select: { id: true } });
  const saleIds = sales.map((s) => s.id);
  report.demoSales = saleIds.length;

  const statementIds = [
    ...new Set(
      (
        await tx.clientStatementLine.findMany({
          where: { sale_id: { in: saleIds } },
          select: { statement_id: true },
        })
      ).map((l) => l.statement_id),
    ),
  ];
  report.demoStatementsRemoved = statementIds.length;
  const runIds = [
    ...new Set(
      (await tx.payRunLine.findMany({ where: { rep_id: { in: repIds } }, select: { pay_run_id: true } })).map(
        (l) => l.pay_run_id,
      ),
    ),
  ];
  const userIds = reps.map((r) => r.user_id).filter((u): u is string => !!u);
  report.demoUsersDeactivated = userIds.length;
  if (!write) {
    report.demoPayRunsRemoved = runIds.length; // upper bound: a run that also paid real reps is kept
    return;
  }

  await removeStatements(tx, statementIds);
  await tx.clawback.deleteMany({ where: { rep_id: { in: repIds } } });
  await removeSales(tx, saleIds);
  await tx.payRunLine.deleteMany({ where: { rep_id: { in: repIds } } });
  // A run that now has no lines, no payroll lines and no sales was a demo-only run.
  for (const runId of runIds) {
    const [lines, payroll, linked, clawbacks] = await Promise.all([
      tx.payRunLine.count({ where: { pay_run_id: runId } }),
      tx.payrollReportLine.count({ where: { pay_run_id: runId } }),
      tx.sale.count({ where: { pay_run_id: runId } }),
      tx.clawback.count({ where: { applied_in_pay_run_id: runId } }),
    ]);
    if (lines + payroll + linked + clawbacks === 0) {
      await tx.payRun.delete({ where: { id: runId } });
      report.demoPayRunsRemoved += 1;
    }
  }

  const items = await tx.expenseItem.findMany({
    where: { OR: [{ rep_id: { in: repIds } }, { expense_report: { rep_id: { in: repIds } } }] },
    select: { id: true },
  });
  const itemIds = items.map((i) => i.id);
  const logs = await tx.expenseKmLog.findMany({ where: { expense_item_id: { in: itemIds } }, select: { id: true } });
  await tx.expenseKmStop.deleteMany({ where: { km_log_id: { in: logs.map((l) => l.id) } } });
  await tx.expenseKmLog.deleteMany({ where: { id: { in: logs.map((l) => l.id) } } });
  await tx.expenseItem.deleteMany({ where: { id: { in: itemIds } } });
  await tx.expenseReport.deleteMany({ where: { rep_id: { in: repIds } } });

  await tx.repDocument.deleteMany({ where: { rep_id: { in: repIds } } });
  await tx.repEquipment.deleteMany({ where: { rep_id: { in: repIds } } });
  await tx.salesTarget.deleteMany({ where: { rep_id: { in: repIds } } });
  await tx.rep.deleteMany({ where: { id: { in: repIds } } });
  if (userIds.length > 0) {
    await tx.refreshSession.deleteMany({ where: { user_id: { in: userIds } } });
    await tx.user.updateMany({ where: { id: { in: userIds } }, data: { status: 'inactive' } });
  }
}

/** Pass 2. */
async function collapseDuplicates(tx: Tx, report: CleanupReport, write: boolean): Promise<void> {
  const live = await tx.sale.findMany({
    where: { mpu_id: { not: null }, status: { not: 'deleted' }, ...NOT_DEMO },
    select: { id: true, client_id: true, mpu_id: true, sale_code: true, status: true, created_at: true },
  });
  const plan = planMpuDuplicates(live);
  report.duplicateGroups = plan.groups;
  report.duplicateBlocked = plan.blocked;
  const ids = plan.groups.flatMap((g) => g.remove.map((s) => s.id));
  if (write && ids.length > 0) {
    await tx.sale.updateMany({ where: { id: { in: ids } }, data: { status: 'deleted' } });
  }
}

/** Pass 3. In a dry run the duplicates of pass 2 are counted as if already deleted. */
async function purgeDeleted(tx: Tx, report: CleanupReport, write: boolean, alsoIds: string[]): Promise<void> {
  const deleted = await tx.sale.findMany({
    where: { OR: [{ status: 'deleted' }, { id: { in: alsoIds } }], ...NOT_DEMO },
    select: { id: true, sale_code: true },
  });
  const ids = deleted.map((s) => s.id);
  const pinned = new Set<string>([
    ...(await tx.clawback.findMany({ where: { sale_id: { in: ids } }, select: { sale_id: true } })).map((r) => r.sale_id),
    ...(await tx.payrollReportLine.findMany({ where: { sale_id: { in: ids } }, select: { sale_id: true } })).map(
      (r) => r.sale_id,
    ),
    ...(await tx.clientStatementLine.findMany({ where: { sale_id: { in: ids } }, select: { sale_id: true } })).map(
      (r) => r.sale_id,
    ),
  ]);
  report.keptDeleted = deleted.filter((s) => pinned.has(s.id)).map((s) => s.sale_code);
  const purge = ids.filter((id) => !pinned.has(id));
  report.purgedDeleted = purge.length;
  if (write) await removeSales(tx, purge);
}

async function findNameLookalikes(tx: Tx): Promise<string[][]> {
  const sales = await tx.sale.findMany({
    where: { mpu_id: null, status: { not: 'deleted' }, ...NOT_DEMO },
    select: { sale_code: true, rep_id: true, client_id: true, sale_date: true, customer_name: true },
  });
  const byKey = new Map<string, string[]>();
  for (const s of sales) {
    const key = [s.rep_id, s.client_id, s.sale_date.toISOString().slice(0, 10), s.customer_name.trim().toLowerCase()].join('|');
    byKey.set(key, [...(byKey.get(key) ?? []), s.sale_code]);
  }
  return [...byKey.values()].filter((codes) => codes.length > 1);
}

export async function runSalesCleanup(prisma: PrismaClient, opts: { write: boolean }): Promise<CleanupReport> {
  const report: CleanupReport = {
    demoReps: [],
    demoSales: 0,
    demoPayRunsRemoved: 0,
    demoStatementsRemoved: 0,
    demoUsersDeactivated: 0,
    duplicateGroups: [],
    duplicateBlocked: [],
    purgedDeleted: 0,
    keptDeleted: [],
    nameLookalikes: [],
  };
  await prisma.$transaction(
    async (tx) => {
      await cleanDemo(tx, report, opts.write);
      await collapseDuplicates(tx, report, opts.write);
      const pendingDupIds = opts.write ? [] : report.duplicateGroups.flatMap((g) => g.remove.map((s) => s.id));
      await purgeDeleted(tx, report, opts.write, pendingDupIds);
      report.nameLookalikes = await findNameLookalikes(tx);
    },
    { timeout: 120_000 },
  );
  return report;
}
