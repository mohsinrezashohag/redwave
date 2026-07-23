/**
 * Demo seed — a fully-exercisable pipeline on top of the bootstrap catalogue, so the deployed system can
 * be tested end-to-end. Reproducible (IDEMPOTENT end-state): catalogue rows upsert by natural key, and all
 * transactional data is wiped + regenerated each run (never duplicated).
 *
 * Invariant-critical steps run through the REAL services (a synthetic Super-Admin AuthUser), so the demo
 * honours every rule instead of hand-rolling writes: pay-run finalize is atomic + idempotent and freezes
 * the immutable snapshots (#8/#2); clawback is a flat snapshot deduction with no re-tiering (#5/#6); the
 * statement prices ONLY from client_billing_rates (#3). Money is exact Decimal (#1). sale_date governs the
 * pay period (#7); the demo is anchored to the run-time CURRENT period so the leaderboard/dashboards are
 * live whenever it runs. Billing rates and commission rates stay in SEPARATE tables (#3 / BRD §8.2).
 */
import { INestApplicationContext } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthUser } from '../../src/common/rbac/auth-user.type';
import { BUILTIN_ROLES } from '../../src/common/rbac/rbac.constants';
import { winnipegDateOnly } from '../../src/common/timezone';
import { currentPeriod } from '../../src/modules/reporting/period.logic';
import { saleCodeBase, withSuffix } from '../../src/modules/sales/sale-id.logic';
import { countsTowardTally } from '../../src/modules/sales/sale-item.logic';
import { PayRunService } from '../../src/modules/payrun/pay-run.service';
import { ClawbackService } from '../../src/modules/clawback/clawback.service';
import { ExpensesService } from '../../src/modules/expenses/expenses.service';
import { ExpenseReportsService } from '../../src/modules/expenses/expense-report.service';
import { ReviewDecision } from '../../src/modules/expenses/dto/review.dto';
import { StatementService } from '../../src/modules/billing/statement.service';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import { NotificationsService } from '../../src/modules/reporting/notifications.service';

export const DEMO_PASSWORD = 'RedwaveDemo!2026'; // throwaway demo-account password (NOT the Super Admin)
const BCRYPT_ROUNDS = 12;
const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addDaysIso = (base: Date, days: number): string => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

function superUser(id: string): AuthUser {
  return {
    id,
    email: 'superadmin@redwave.local',
    full_name: 'Super Admin',
    status: 'active',
    roleNames: [BUILTIN_ROLES.SUPER_ADMIN],
    isSuperAdmin: true,
    permissions: new Set<string>(),
    repId: null,
  };
}

export async function seedDemo(
  prisma: PrismaClient,
  app: INestApplicationContext,
  superAdminUserId: string,
): Promise<void> {
  // Reproducibility: clear all transactional data, then regenerate it fresh (catalogue is kept/upserted).
  const { wipeTransactional } = await import('./wipe');
  await wipeTransactional(prisma);

  const sa = superUser(superAdminUserId);
  const payRuns = app.get(PayRunService);
  const clawbacks = app.get(ClawbackService);
  const expenses = app.get(ExpensesService);
  const expenseReports = app.get(ExpenseReportsService);
  const statements = app.get(StatementService);
  const documents = app.get(DocumentsService);
  const notifications = app.get(NotificationsService);

  // ── Catalogue: clients + products + billing rates (the BILLING stream — separate from commission, #3) ──
  const genesis = dateOnly('2024-01-01'); // back-dated so the rate is always current (#10)
  const CLIENTS = [
    { code: 'VF', name: 'Valley Fiber', mpu: true },
    { code: 'RF', name: 'RF Now', mpu: true },
    { code: 'CTI', name: 'CTI', mpu: false },
  ];
  const PRODUCTS: { type: string; name: string; bill: string }[] = [
    { type: 'internet', name: 'Internet', bill: '60.00' },
    { type: 'tv', name: 'TV', bill: '25.00' },
    { type: 'home_phone', name: 'Home Phone', bill: '20.00' },
  ];
  // clientByCode[code] = { id, client_code, products: { [type]: productId } }
  const clientByCode: Record<string, { id: string; client_code: string; mpu: boolean; products: Record<string, string> }> = {};
  for (const c of CLIENTS) {
    const client = await prisma.client.upsert({
      where: { client_code: c.code },
      update: { name: c.name, supplies_mpu_id: c.mpu, is_active: true },
      create: { client_code: c.code, name: c.name, market: 'CA', supplies_mpu_id: c.mpu, is_active: true },
    });
    const products: Record<string, string> = {};
    for (const p of PRODUCTS) {
      let product = await prisma.product.findFirst({ where: { client_id: client.id, name: p.name } });
      if (!product) {
        product = await prisma.product.create({
          data: { client_id: client.id, name: p.name, product_type: p.type, is_active: true },
        });
      }
      products[p.type] = product.id;
      // Current client billing rate (rate_kind 'product'), effective from genesis.
      const rate = await prisma.clientBillingRate.findFirst({
        where: { client_id: client.id, product_id: product.id, rate_kind: 'product', effective_from: genesis },
      });
      if (!rate) {
        await prisma.clientBillingRate.create({
          data: { client_id: client.id, product_id: product.id, rate_kind: 'product', amount: p.bill, effective_from: genesis, created_by: superAdminUserId },
        });
      }
    }
    clientByCode[c.code] = { id: client.id, client_code: client.client_code, mpu: c.mpu, products };
  }

  // ── Catalogue: a manager + a roster of reps (stable codes, never reused #11); a few with logins ──
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const ensureUser = async (email: string, fullName: string, roleName: string): Promise<string> => {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, password_hash: demoHash, full_name: fullName, theme_preference: 'system', status: 'active' },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userRole.upsert({
      where: { user_id_role_id: { user_id: user.id, role_id: role.id } },
      update: {},
      create: { user_id: user.id, role_id: role.id },
    });
    return user.id;
  };
  const managerUserId = await ensureUser('manager@demo.redwave.local', 'Morgan Manager', BUILTIN_ROLES.MANAGER);

  const REPS = [
    { code: 'RW-D-0001', name: 'Riley Rivera', login: 'rep1@demo.redwave.local' },
    { code: 'RW-D-0002', name: 'Sam Stone', login: 'rep2@demo.redwave.local' },
    { code: 'RW-D-0003', name: 'Avery Adams', login: 'rep3@demo.redwave.local' },
    { code: 'RW-D-0004', name: 'Jordan Lee' },
    { code: 'RW-D-0005', name: 'Casey Nguyen' },
    { code: 'RW-D-0006', name: 'Drew Patel' },
    { code: 'RW-D-0007', name: 'Quinn Murphy' },
    { code: 'RW-D-0008', name: 'Taylor Brooks' },
  ];
  const repByCode: Record<string, { id: string }> = {};
  for (const r of REPS) {
    const userId = r.login ? await ensureUser(r.login, r.name, BUILTIN_ROLES.SALES_REP) : null;
    const rep = await prisma.rep.upsert({
      where: { rep_code: r.code },
      update: { full_name: r.name, field_manager_id: managerUserId, status: 'active', ...(userId ? { user_id: userId } : {}) },
      create: {
        rep_code: r.code,
        full_name: r.name,
        field_manager_id: managerUserId,
        status: 'active',
        hire_date: dateOnly('2025-09-01'),
        ...(userId ? { user_id: userId } : {}),
      },
    });
    repByCode[r.code] = { id: rep.id };
  }

  // ── Periods: anchor to the run-time CURRENT period so the leaderboard/dashboards (which scope to "today")
  //    are populated; finalize an earlier (closed) period; spread sales across three cycles by sale_date. ──
  const periods = await prisma.payPeriod.findMany({ orderBy: { period_number: 'asc' } });
  const cur = currentPeriod(periods, winnipegDateOnly());
  if (!cur) throw new Error('No current pay period — seed the bootstrap pay periods first.');
  const curIdx = periods.findIndex((p) => p.id === cur.id);
  const prev1 = periods[curIdx - 1] ?? periods[Math.max(0, curIdx - 1)];
  const prev2 = periods[curIdx - 2] ?? periods[Math.max(0, curIdx - 2)];

  // ── Sales (direct inserts; snapshots stay NULL until finalize #2). sale_date governs the period (#7). ──
  const codeCounts = new Map<string, number>();
  type SaleSpec = {
    repCode: string;
    clientCode: string;
    saleDate: string;
    customer: string;
    items: string[];
    greenfield?: boolean;
    validated?: boolean;
  };
  const createSale = async (s: SaleSpec) => {
    const client = clientByCode[s.clientCode];
    const mpu = client.mpu ? `MPU-${s.repCode.slice(-3)}-${(codeCounts.size + 1).toString().padStart(3, '0')}` : null;
    const base = saleCodeBase({ saleDate: s.saleDate, clientCode: client.client_code, mpuId: mpu });
    const n = codeCounts.get(base) ?? 0;
    codeCounts.set(base, n + 1);
    const greenfield = s.greenfield ?? false;
    return prisma.sale.create({
      data: {
        sale_code: withSuffix(base, n),
        sale_date: dateOnly(s.saleDate),
        rep_id: repByCode[s.repCode].id,
        client_id: client.id,
        customer_name: s.customer,
        street: '123 Demo St',
        city: 'Winnipeg',
        province_state: 'MB',
        postal_code: 'R3C 0V8',
        mpu_id: mpu,
        is_greenfield: greenfield,
        status: s.validated ? 'validated' : 'entered',
        validated_by: s.validated ? superAdminUserId : null,
        validated_at: s.validated ? new Date() : null,
        sale_items: {
          create: s.items.map((type) => ({
            product_id: clientByCode[s.clientCode].products[type]!,
            product_type: type,
            counts_toward_tally: countsTowardTally(type, greenfield),
            item_status: 'active',
          })),
        },
      },
    });
  };

  // Bulk helper: N single-product sales (distinct customers) for a rep/client/date.
  const bulk = async (repCode: string, clientCode: string, date: string, type: string, count: number, validated = true, greenfield = false) => {
    for (let i = 0; i < count; i += 1) {
      await createSale({ repCode, clientCode, saleDate: date, customer: `${repCode.slice(-2)}-${clientCode}-${type}-${i + 1}`, items: [type], validated, greenfield });
    }
  };

  const p2Mid = addDaysIso(prev2.start_date, 3);
  const p1Mid = addDaysIso(prev1.start_date, 4);
  const curMid = addDaysIso(cur.start_date, 2);
  const curStart = iso(cur.start_date); // a boundary sale (first day of the current Winnipeg period)

  // prev2 — the cycle we FINALIZE. Rep2 reaches Tier 2 via a CROSS-CLIENT internet tally (10 VF + 8 RF = 18).
  await bulk('RW-D-0002', 'VF', p2Mid, 'internet', 10);
  await bulk('RW-D-0002', 'RF', p2Mid, 'internet', 8);
  await createSale({ repCode: 'RW-D-0002', clientCode: 'VF', saleDate: p2Mid, customer: 'S2-bundle', items: ['internet', 'tv'], validated: true });
  await createSale({ repCode: 'RW-D-0002', clientCode: 'VF', saleDate: p2Mid, customer: 'S2-greenfield', items: ['internet'], greenfield: true, validated: true }); // greenfield → flat $100, excluded (#9)
  await bulk('RW-D-0003', 'VF', p2Mid, 'internet', 5);
  await createSale({ repCode: 'RW-D-0003', clientCode: 'VF', saleDate: p2Mid, customer: 'S3-hp', items: ['home_phone'], validated: true });
  await bulk('RW-D-0004', 'RF', p2Mid, 'internet', 8);
  await createSale({ repCode: 'RW-D-0004', clientCode: 'RF', saleDate: p2Mid, customer: 'S4-tv', items: ['tv'], validated: true });
  await bulk('RW-D-0005', 'CTI', p2Mid, 'internet', 3);

  // prev1 — recent history (validated, not yet paid).
  await bulk('RW-D-0001', 'VF', p1Mid, 'internet', 3);
  await createSale({ repCode: 'RW-D-0002', clientCode: 'VF', saleDate: p1Mid, customer: 'S2-tvA', items: ['tv'], validated: true });
  await createSale({ repCode: 'RW-D-0002', clientCode: 'VF', saleDate: p1Mid, customer: 'S2-tvB', items: ['tv'], validated: true });

  // cur — the live cycle (drives the leaderboard + dashboards). Rep1 = 12 VF + 9 RF internet = 21 → Tier 2.
  await bulk('RW-D-0001', 'VF', curMid, 'internet', 12);
  await bulk('RW-D-0001', 'RF', curMid, 'internet', 9);
  await createSale({ repCode: 'RW-D-0001', clientCode: 'VF', saleDate: curMid, customer: 'S1-tv', items: ['tv'], validated: true });
  await bulk('RW-D-0003', 'VF', curMid, 'internet', 6);
  await bulk('RW-D-0002', 'RF', curMid, 'internet', 4);
  await createSale({ repCode: 'RW-D-0006', clientCode: 'CTI', saleDate: curStart, customer: 'S6-boundary', items: ['internet'], validated: true }); // boundary: first day of the Winnipeg period
  await bulk('RW-D-0005', 'VF', curMid, 'internet', 2, false); // ENTERED (pending validation → admin queue)

  // ── Finalize the earlier (closed) cycle: freezes snapshots, 70/30 split + holdback ledger (#8/#2). ──
  await prisma.payPeriod.update({ where: { id: prev2.id }, data: { status: 'closed' } });
  const draft = await payRuns.createDraft({ pay_period_id: prev2.id }, sa);
  await payRuns.finalize(draft.id, sa);

  // ── 1–2 clawbacks against PAID items from that run (flat snapshot deduction; no re-tiering #5/#6). ──
  const paidTv = await prisma.saleItem.findFirst({
    where: { product_type: 'tv', commission_paid: { not: null }, item_status: 'active', sale: { rep_id: repByCode['RW-D-0004'].id } },
  });
  if (paidTv) {
    await clawbacks.enter({ sale_item_id: paidTv.id, reason: 'Customer cancelled TV within the contract window.', reported_date: p1Mid }, sa);
  }
  const paidInternet = await prisma.saleItem.findFirst({
    where: { product_type: 'internet', counts_toward_tally: true, commission_paid: { not: null }, item_status: 'active', sale: { rep_id: repByCode['RW-D-0002'].id } },
  });
  if (paidInternet) {
    await clawbacks.enter({ sale_item_id: paidInternet.id, reason: 'Install failed; activation reversed by the client.', reported_date: p1Mid }, sa);
  }

  // ── A client statement (one row per sale, every rate kind), priced ONLY from billing rates (#3). Billing
  //    runs on its own WEEKLY calendar, so find the week containing the demo's prev2 sales rather than
  //    reusing the pay period. — docs/uat/billing-target-format.md
  const billingWeek = await prisma.billingPeriod.findFirst({
    where: { start_date: { lte: new Date(`${p2Mid}T00:00:00.000Z`) }, end_date: { gte: new Date(`${p2Mid}T00:00:00.000Z`) } },
  });
  if (billingWeek) {
    await statements.generate(clientByCode['VF'].id, billingWeek.id, superAdminUserId);
  }

  // ── Expenses (REPORT-AS-FOLDER, EXP-001): a rep's weekly folder holds a km item (multi-stop) + a meals
  //    item — submitted, then both APPROVED; a second folder holds a gas item left submitted (→ admin queue).
  //    Each item's pay period is still derived from its own date (EXP-009); the folder is a grouping layer.
  const businessWeek = (iso: string): { week_start: string; week_end: string } => {
    const d = new Date(`${iso}T00:00:00.000Z`);
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { week_start: monday.toISOString().slice(0, 10), week_end: sunday.toISOString().slice(0, 10) };
  };

  const w1 = businessWeek(curMid);
  const folder1 = await expenseReports.create({ name: `Field week of ${w1.week_start}`, ...w1, rep_id: repByCode['RW-D-0001'].id }, sa);
  const approvedItems = await expenses.createItems(
    {
      expense_report_id: folder1.id,
      items: [
        {
          category: 'km',
          expense_date: curMid,
          description: 'Client visits — Winnipeg loop',
          km: {
            trip_type: 'round',
            total_km: '130.00',
            stops: [
              { stop_order: 0, address: '123 Main St, Winnipeg', lat: '49.895100', lng: '-97.138400' },
              { stop_order: 1, address: '500 Portage Ave, Winnipeg', lat: '49.889700', lng: '-97.153300' },
              { stop_order: 2, address: '1485 Pembina Hwy, Winnipeg', lat: '49.833900', lng: '-97.152600' },
            ],
          },
        },
        { category: 'meals', expense_date: curMid, amount: '42.50', description: 'Lunch with prospect', receipt_url: 's3://redwave-demo/receipts/meal-1.jpg', field_values: { vendor: 'The Keg', city: 'Winnipeg' } },
      ],
    },
    sa,
  );
  await expenseReports.submit(folder1.id, sa); // draft → submitted
  for (const item of approvedItems) {
    await expenses.review(item.id, { decision: ReviewDecision.approve }, sa);
  }

  const w2 = businessWeek(p1Mid);
  const folder2 = await expenseReports.create({ name: `Field week of ${w2.week_start}`, ...w2, rep_id: repByCode['RW-D-0002'].id }, sa);
  await expenses.createItems(
    { expense_report_id: folder2.id, items: [{ category: 'gas', expense_date: p1Mid, amount: '60.00', description: 'Fuel — field route', receipt_url: 's3://redwave-demo/receipts/gas-1.jpg' }] },
    sa,
  );
  await expenseReports.submit(folder2.id, sa); // → submitted (feeds the approval queue)

  // ── A document with a PENDING signature request (→ admin queue + a signature_requested notification). ──
  // A minimal valid PDF (header + EOF) — stored gracefully (local:// ref when storage is unconfigured).
  const stubPdf = {
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
    originalname: 'compensation-agreement-2026.pdf',
    mimetype: 'application/pdf',
    size: 46,
  };
  const rep1UserId = (await prisma.rep.findUniqueOrThrow({ where: { rep_code: 'RW-D-0001' }, select: { user_id: true } })).user_id;
  const doc = await documents.upload({ title: 'Compensation Agreement 2026', doc_type: 'compensation_agreement' }, stubPdf, sa);
  if (rep1UserId) {
    await documents.requestSignature(doc.id, { recipient_user_ids: [rep1UserId], message: 'Please review and sign your 2026 compensation agreement.' }, sa);
  }

  // ── Notifications: emit one to the manager + mark roughly half read (a mix of read + unread). ──
  await notifications.notify('pay_run_finalized', managerUserId, {
    title: 'Pay run finalized',
    body: `The pay run for period ${prev2.period_number} has been finalized.`,
  });
  const unread = await prisma.notification.findMany({ orderBy: { created_at: 'asc' } });
  for (let i = 0; i < unread.length; i += 2) {
    await prisma.notification.update({ where: { id: unread[i].id }, data: { is_read: true } });
  }

  console.log(
    `Demo: 3 clients, ${REPS.length} reps + a manager, sales across periods ${prev2.period_number}/${prev1.period_number}/${cur.period_number} ` +
      `(finalized P${prev2.period_number}), clawbacks, a VF statement, 2 expense reports, 1 document w/ pending signature, notifications. ` +
      `Demo logins use password "${DEMO_PASSWORD}".`,
  );
}
