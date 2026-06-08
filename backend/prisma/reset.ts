/**
 * seed:reset — the pre-handover CLEAN WIPE. Clears ALL transactional data (FK-safe; see seed/wipe.ts) and
 * re-seeds the bootstrap catalogue, KEEPING the master catalogue (clients/products/reps/commission config/
 * pay periods) and the login. This CANNOT go through the UI (the app soft-deletes; the DB RESTRICTs hard
 * deletes), so it is a deliberate DB-level operation. Guarded by RESET_CONFIRM=yes so it never runs by
 * accident. — CLAUDE §11
 *
 * Run:  RESET_CONFIRM=yes npm -w backend run seed:reset
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedBootstrap } from './seed/bootstrap';
import { wipeTransactional } from './seed/wipe';

async function main(): Promise<void> {
  if (process.env.RESET_CONFIRM !== 'yes') {
    console.error(
      '\n✋ seed:reset is a DESTRUCTIVE clean-wipe — it clears ALL transactional data (sales, pay runs,\n' +
        '   expenses, statements, notifications, documents, chatbot conversations, imports, audit log).\n' +
        '   The master catalogue (login, roles, clients, products, reps, commission config, pay periods,\n' +
        '   chatbot config) is preserved. Re-run with the confirmation flag to proceed:\n\n' +
        '     RESET_CONFIRM=yes npm -w backend run seed:reset\n',
    );
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  try {
    await wipeTransactional(prisma);
    await seedBootstrap(prisma); // idempotent — guarantees RBAC / roles / Super Admin / pay periods / chatbot_config
    console.log('Reset complete: transactional data cleared; bootstrap + master catalogue intact.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
