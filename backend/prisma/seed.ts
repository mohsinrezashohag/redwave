/**
 * Seed entry — wired to `prisma db seed` (npm run prisma:seed). Boots a Nest application CONTEXT so the
 * demo can drive the REAL services (authentic, invariant-honouring pipeline: atomic+idempotent pay-run
 * finalize, clawback off the frozen snapshot, statement priced from billing rates). Seeds the bootstrap
 * catalogue, then the rich demo. Idempotent end-state: re-running yields the same data (no duplicates).
 *
 * Clean-wipe for handover is a SEPARATE script: `npm run seed:reset` (prisma/reset.ts). — CLAUDE §11
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedBootstrap } from './seed/bootstrap';
import { seedDemo } from './seed/demo';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  try {
    const { superAdminUserId } = await seedBootstrap(prisma);
    await seedDemo(prisma, app, superAdminUserId);
    console.log('Seed complete (bootstrap + demo).');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
