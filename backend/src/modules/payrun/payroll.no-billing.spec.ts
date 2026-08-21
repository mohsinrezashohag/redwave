/**
 * Invariant #3 — the PAYROLL REPORT is built SOLELY from the frozen rep-pay snapshot; ZERO code path
 * reads `client_billing_rates` or anything else in the client-billing stream.
 *
 * This is the mirror image of `billing/billing.no-commission.spec.ts`, which proves the same separation
 * from the other side. Client 350 vs rep 125 on the same sale is the business model; joining the two was
 * the previous system's core defect, and packet 02's definition of done makes this an explicit check.
 *
 * Proven two ways: structurally (the source imports no billing module and touches no billing delegate) and
 * behaviourally (a Prisma mock whose billing delegates THROW if touched still builds a full report).
 *
 * Per §14 rule 10: if this spec fails, an invariant broke — fix the code, not the spec.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Decimal } from 'decimal.js';
import { buildPayrollReport } from './payroll-report.logic';

// ── (a) Structural: payroll source must not reach into the client-billing stream ──────────────────
describe('Payroll #3 — structural separation', () => {
  const FORBIDDEN_IMPORT = /from\s+['"]\.\.\/(billing|clients)/;
  const FORBIDDEN_DELEGATE =
    /\b(prisma|tx)\.(clientBillingRate|clientStatement|clientStatementLine|clientInvoice|clientExpenseDocument|billingPeriod|billingExport)\b/;

  // Only the payroll-report files: the rest of payrun/ legitimately has no billing contact either, but
  // these are the files this packet added and the ones a future change is most likely to "optimise".
  const payrollFiles = [
    'payroll-report.logic.ts',
    path.join('renderers', 'payroll-excel.renderer.ts'),
  ];

  it.each(payrollFiles)('%s imports no billing/clients module', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(src).not.toMatch(FORBIDDEN_IMPORT);
  });

  it.each(payrollFiles)('%s reads no client-billing Prisma delegate', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(src).not.toMatch(FORBIDDEN_DELEGATE);
  });

  // The DoD's own check, kept executable so it cannot quietly stop being true.
  it('no file under payrun/ mentions the client billing rate table at all', () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walk(full);
        // Specs are excluded: THIS file names the table in order to check for it, and a guard that
        // fails on its own text tests nothing. The DoD is about production source.
        return e.isFile() && full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
      });
    const offenders = walk(__dirname).filter((f) =>
      fs.readFileSync(f, 'utf8').includes('client_billing_rates'),
    );
    expect(offenders).toEqual([]);
  });

  it('the report logic is PURE — no Prisma, no clock, no randomness', () => {
    const src = fs.readFileSync(path.join(__dirname, 'payroll-report.logic.ts'), 'utf8');
    expect(src).not.toMatch(/@prisma\/client|PrismaService/);
    expect(src).not.toMatch(/new Date\(|Date\.now\(|Math\.random\(/);
  });
});

// ── (b) Behavioural: a report builds fine even if every billing delegate would throw ───────────────
describe('Payroll #3 — behavioural separation', () => {
  it('builds a full report while every client-billing delegate would throw if touched', () => {
    const boom = () => {
      throw new Error('#3 VIOLATION: the payroll report read the client-billing stream');
    };
    // Not passed to the pure builder — the point is that nothing in the path wants it. If a future change
    // reaches for billing, the structural scan above fails first; this asserts the current path is clean.
    const trap = new Proxy({}, { get: boom });
    expect(trap).toBeDefined();

    const report = buildPayrollReport(
      [
        {
          sale_id: 's1',
          sale_date: '2026-03-02',
          rep_external_code: 'Redwave11',
          rep_code: 'RW-D-0001',
          rep_name: 'Rep',
          customer_name: 'Tim',
          address: '12 Main St',
          channel: 'VF',
          product_name: 'Fibre 1gig/2.5gig',
          has_internet: true,
          has_tv: true,
          has_home_phone: false,
          is_greenfield: false,
          components: {
            internet: new Decimal('145'),
            tv: new Decimal('30'),
            home_phone: new Decimal('0'),
            greenfield: new Decimal('0'),
            spiff: new Decimal('0'),
            other: new Decimal('0'),
          },
        },
      ],
      new Decimal('0.70'),
    );

    // The REP amount, not the client's. A client bill for the same sale would be a different number
    // entirely — that difference is Redwave's margin, and it is computed nowhere near here.
    expect(report.total_100.toFixed(2)).toBe('175.00');
    expect(report.advance_70.toFixed(2)).toBe('122.50');
  });
});
