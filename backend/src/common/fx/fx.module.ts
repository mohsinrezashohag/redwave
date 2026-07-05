/**
 * FxModule — provides the FX rate source globally (used by expenses approval + billing issue). @Global so
 * any domain module injects FxRateService without an explicit import (mirrors common/email, common/storage).
 */
import { Global, Module } from '@nestjs/common';
import { FxRateService } from './fx-rate.service';

@Global()
@Module({
  providers: [FxRateService],
  exports: [FxRateService],
})
export class FxModule {}
