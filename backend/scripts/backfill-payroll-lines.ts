/**
 * payroll:backfill — one-off OPERATOR backfill of `payroll_report_lines` for pay runs finalized BEFORE that
 * table existed (packet 02, migration 20260704000000). Those runs show an EMPTY pay statement and payroll
 * workbook although they were paid. The logic + its safety checks live in
 * `PayRunService.backfillPayrollLines` (rebuilt from frozen snapshots only, reconciled against the frozen
 * pay-run lines, one transaction per run, idempotent); this file only drives it.
 *
 * DRY RUN BY DEFAULT — prints what each run would get and writes nothing:
 *   npm -w backend run payroll:backfill
 * Then, once the numbers match the pay-run screen:
 *   BACKFILL_CONFIRM=yes npm -w backend run payroll:backfill
 *
 * The audit row is attributed to the Super Admin in SEED_SUPERADMIN_EMAIL (the account sa:reset uses).
 * A refused run (a reconciliation mismatch) is reported and skipped; the exit code is then 1.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PayRunService } from '../src/modules/payrun/pay-run.service';

async function main(): Promise<void> {
  const dryRun = process.env.BACKFILL_CONFIRM !== 'yes';
  const email = (process.env.SEED_SUPERADMIN_EMAIL ?? '').trim();
  if (!email) {
    throw new Error('SEED_SUPERADMIN_EMAIL is not set — the backfill is audited as that Super Admin.');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const payRuns = app.get(PayRunService);
  let failed = 0;
  try {
    const actor = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!actor) {
      throw new Error('The SEED_SUPERADMIN_EMAIL account was not found in this database.');
    }

    console.log(dryRun ? 'DRY RUN — nothing will be written.\n' : 'WRITING payroll lines.\n');
    for (const runId of await payRuns.finalizedRunIds()) {
      try {
        const r = await payRuns.backfillPayrollLines(runId, { dryRun, actorId: actor.id });
        console.log(`Run #${r.period_number}: ${r.outcome}`);
        for (const rep of r.reps) {
          console.log(
            `   ${rep.rep_code.padEnd(12)} ${String(rep.sales).padStart(3)} sales   commission ${rep.commission.padStart(10)}`,
          );
        }
      } catch (e) {
        failed += 1;
        console.error(`Run ${runId}: REFUSED — ${(e as Error).message}`);
      }
    }
    if (dryRun) {
      console.log('\nCheck the figures against each run’s Pay Run screen, then re-run with BACKFILL_CONFIRM=yes.');
    }
  } finally {
    await app.close();
  }
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
