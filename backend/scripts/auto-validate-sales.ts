/**
 * sales:auto-validate — ONE-TIME: validate the sales entered before "no per-sale validation" went live
 * (App Review Feedback, 2026-11-28). Held possible duplicates are left for review. The logic and its safety
 * rules live in `src/common/ops/sales-autovalidate.ts`; this file only drives and prints it.
 *
 * DRY RUN BY DEFAULT — prints the plan and writes nothing:
 *   npm -w backend run sales:auto-validate
 * Then, once the list looks right:
 *   AUTOVALIDATE_CONFIRM=yes npm -w backend run sales:auto-validate
 */
import { PrismaClient } from '@prisma/client';
import { runSalesAutoValidate } from '../src/common/ops/sales-autovalidate';

async function main(): Promise<void> {
  const write = process.env.AUTOVALIDATE_CONFIRM === 'yes';
  const prisma = new PrismaClient();
  try {
    console.log(write ? 'WRITING.\n' : 'DRY RUN. Nothing will be written.\n');
    const plan = await runSalesAutoValidate(prisma, { write });
    console.log(`Validator recorded: ${plan.actorEmail ?? 'NONE FOUND (a write would be refused)'}`);
    console.log(`\n${write ? 'Validated' : 'Would validate'}: ${plan.validate.length} sales`);
    if (plan.validate.length > 0) console.log(`   ${plan.validate.join(', ')}`);
    console.log(`\nLeft for review (possible duplicates not yet approved): ${plan.held.length}`);
    if (plan.held.length > 0) console.log(`   ${plan.held.join(', ')}`);
    if (!write) console.log('\nReview the list above, then re-run with AUTOVALIDATE_CONFIRM=yes.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
