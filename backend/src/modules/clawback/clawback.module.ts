import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import {
  CLAWBACK_TOTAL_PROVIDER,
  ZeroClawbackTotalProvider,
} from '../payrun/seams/clawback-total.provider';
import { ClawbackController } from './clawback.controller';
import { ClawbackService } from './clawback.service';
import { ClawbackPayrunProvider } from './clawback-payrun.provider';

@Module({
  imports: [EngineModule], // for CommissionEngineService.computeClawbackAmount (reused, not reimplemented)
  controllers: [ClawbackController],
  providers: [
    ClawbackService,
    // Kept (with its spec) so clawback deductions can be switched back on by re-pointing the token below.
    ClawbackPayrunProvider,
    // Client decision 2026-11-16 ("Remove clawbacks"): commission reports apply NO clawback deduction. The
    // Pay Run seam is bound to the zero provider, so drafts and finalize read 0 and mark nothing applied.
    // The clawback records, service and endpoints stay (hidden from the app, no data deleted).
    { provide: CLAWBACK_TOTAL_PROVIDER, useClass: ZeroClawbackTotalProvider },
  ],
  // Exported so PayRunModule imports this module to satisfy CLAWBACK_TOTAL_PROVIDER.
  exports: [CLAWBACK_TOTAL_PROVIDER],
})
export class ClawbackModule {}
