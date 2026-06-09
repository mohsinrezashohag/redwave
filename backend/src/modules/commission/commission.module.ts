import { Module } from '@nestjs/common';
import { CommissionController, IncentivesController, ProductTypesController } from './commission.controller';
import { TierScheduleService } from './tier-schedule.service';
import { FlatRateService } from './flat-rate.service';
import { HoldbackService } from './holdback.service';
import { IncentiveService } from './incentive.service';
import { ProductTypeService } from './product-type.service';
import { CommissionConfigProvider } from './commission-config.provider';

@Module({
  controllers: [CommissionController, IncentivesController, ProductTypesController],
  providers: [
    TierScheduleService,
    FlatRateService,
    HoldbackService,
    IncentiveService,
    ProductTypeService,
    CommissionConfigProvider,
  ],
  // CommissionConfigProvider is exported so Pay Run (later) can read engine config from stored values.
  exports: [CommissionConfigProvider],
})
export class CommissionModule {}
