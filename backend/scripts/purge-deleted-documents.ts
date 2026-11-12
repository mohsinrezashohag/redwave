/**
 * documents:purge — run the rep-document purge by hand (2026-11-12). The server already runs it every night at
 * 03:00 America/Winnipeg and a minute after it starts; this is for an operator who wants storage freed now or
 * wants to see what is due. The logic lives in `RepDocumentPurgeService.purgeExpired` (objects removed first,
 * then rows; refused objects are kept for the next run); this file only drives it.
 *
 * DRY RUN BY DEFAULT: prints how many documents have been in Recently deleted for more than 30 days.
 *   npm -w backend run documents:purge
 *   PURGE_CONFIRM=yes npm -w backend run documents:purge
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RepDocumentPurgeService } from '../src/modules/hrm/rep-document-purge.service';

async function main(): Promise<void> {
  const write = process.env.PURGE_CONFIRM === 'yes';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const purge = app.get(RepDocumentPurgeService);
    const now = new Date();
    if (!write) {
      const due = await purge.countDue(now);
      console.log(`DRY RUN: ${due} deleted document(s) are past 30 days and would be removed for good.`);
      if (due > 0) console.log('Re-run with PURGE_CONFIRM=yes to remove them.');
      return;
    }
    const r = await purge.purgeExpired(now);
    console.log(`Removed ${r.purged} document(s) for good. ${r.failed} kept because storage refused (retried next run).`);
    if (r.failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
