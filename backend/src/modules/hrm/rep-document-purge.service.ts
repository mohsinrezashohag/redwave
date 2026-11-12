/**
 * RepDocumentPurgeService — removes rep documents for good once they have sat in "Recently deleted" for 30
 * days (2026-11-12), so storage is freed. Runs daily at 03:00 America/Winnipeg (@nestjs/schedule) and once
 * shortly after the server starts (a sleeping instance still catches up); `npm run documents:purge` runs it by
 * hand (dry-run default).
 *
 * Inputs: rep_documents rows with deleted_at older than the retention window. Outputs: the stored objects are
 * removed FIRST, then the rows are hard-deleted; when storage refuses, the rows are kept for the next run, so
 * a file is never orphaned by a half-done purge. Idempotent: a re-run (or two instances) finds nothing new.
 * Owns no table. The delete itself was audited when HR made it; the purge is a system job (audit_log needs a
 * user), so it only logs counts to the server log (never a path or a name).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { purgeCutoff } from './rep-documents.logic';

const BATCH = 100;

export interface PurgeResult {
  /** Rows due (older than 30 days in the bin). */
  due: number;
  /** Rows (and their objects) actually removed. */
  purged: number;
  /** Rows kept because storage refused; retried next run. */
  failed: number;
}

@Injectable()
export class RepDocumentPurgeService {
  private readonly logger = new Logger(RepDocumentPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** The daily run. Never throws: a failed night is logged and simply retried the next night. */
  @Cron('0 3 * * *', { name: 'rep-document-purge', timeZone: 'America/Winnipeg' })
  async runScheduled(): Promise<void> {
    try {
      const r = await this.purgeExpired(new Date());
      if (r.due > 0) this.logger.log(`Rep document purge: ${r.purged} removed, ${r.failed} kept for retry`);
    } catch (err) {
      this.logger.error(`Rep document purge failed: ${(err as Error).message}`);
    }
  }

  /** Count what is due without removing anything (the script's dry run). */
  async countDue(now: Date): Promise<number> {
    return this.prisma.repDocument.count({ where: { deleted_at: { lt: purgeCutoff(now) } } });
  }

  async purgeExpired(now: Date): Promise<PurgeResult> {
    const cutoff = purgeCutoff(now);
    const result: PurgeResult = { due: 0, purged: 0, failed: 0 };
    const skipped: string[] = []; // ids whose objects storage refused this run (don't loop on them)
    for (;;) {
      const batch = await this.prisma.repDocument.findMany({
        where: { deleted_at: { lt: cutoff }, id: { notIn: skipped } },
        select: { id: true, file_url: true },
        orderBy: { deleted_at: 'asc' },
        take: BATCH,
      });
      if (batch.length === 0) break;
      result.due += batch.length;
      const removed = await this.storage.remove(batch.map((d) => d.file_url));
      if (!removed) {
        result.failed += batch.length;
        skipped.push(...batch.map((d) => d.id));
        continue;
      }
      // Re-check deleted_at so a document restored in the meantime is never hard-deleted.
      const { count } = await this.prisma.repDocument.deleteMany({
        where: { id: { in: batch.map((d) => d.id) }, deleted_at: { lt: cutoff } },
      });
      result.purged += count;
    }
    return result;
  }
}
