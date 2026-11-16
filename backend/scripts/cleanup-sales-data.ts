/**
 * data:cleanup — one-off PRE-HANDOVER cleanup of the sales data (2026-11-16): removes the demo reps
 * (RW-D-*) and everything they own, collapses live sales that share a client + MPU (the re-imported files
 * that would have paid a rep twice) and purges soft-deleted re-import copies. The logic and its safety
 * rules live in `src/common/ops/sales-cleanup.ts`; this file only drives and prints it.
 *
 * DRY RUN BY DEFAULT — prints the plan and writes nothing:
 *   npm -w backend run data:cleanup
 * Then, once the list looks right:
 *   CLEANUP_CONFIRM=yes npm -w backend run data:cleanup
 */
import { PrismaClient } from '@prisma/client';
import { runSalesCleanup } from '../src/common/ops/sales-cleanup';

async function main(): Promise<void> {
  const write = process.env.CLEANUP_CONFIRM === 'yes';
  const prisma = new PrismaClient();
  try {
    console.log(write ? 'WRITING the cleanup.\n' : 'DRY RUN. Nothing will be written.\n');
    const r = await runSalesCleanup(prisma, { write });

    console.log(`1. Demo data: ${r.demoReps.length} reps (${r.demoReps.join(', ') || 'none'})`);
    console.log(`   ${r.demoSales} sales, ${r.demoStatementsRemoved} statements, up to ${r.demoPayRunsRemoved} pay runs removed`);
    console.log(`   ${r.demoUsersDeactivated} demo logins deactivated`);

    console.log(`\n2. Duplicate MPUs: ${r.duplicateGroups.length} groups`);
    for (const g of r.duplicateGroups) {
      console.log(`   keep ${g.keep.sale_code} (${g.keep.status})  remove ${g.remove.map((s) => `${s.sale_code} (${s.status})`).join(', ')}`);
    }
    for (const b of r.duplicateBlocked) {
      console.log(`   NOT TOUCHED (more than one copy already paid): ${b.map((s) => `${s.sale_code} (${s.status})`).join(', ')}`);
    }

    console.log(`\n3. Deleted sales purged: ${r.purgedDeleted}`);
    if (r.keptDeleted.length > 0) {
      console.log(`   kept (a clawback, payroll line or statement still points at them): ${r.keptDeleted.join(', ')}`);
    }

    if (r.nameLookalikes.length > 0) {
      console.log(`\nFor a manual look (same rep, client, date and customer name, no MPU; not touched):`);
      for (const codes of r.nameLookalikes) console.log(`   ${codes.join(', ')}`);
    }
    if (!write) console.log('\nReview the list above, then re-run with CLEANUP_CONFIRM=yes.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
