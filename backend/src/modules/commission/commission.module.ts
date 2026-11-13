import { Module } from '@nestjs/common';
import { CommissionController, IncentivesController, ProductTypesController } from './commission.controller';
import { FlatRateService } from './flat-rate.service';
import { IncentiveService } from './incentive.service';
import { ProductTypeService } from './product-type.service';
import { CommissionConfigProvider } from './commission-config.provider';

@Module({
  controllers: [CommissionController, IncentivesController, ProductTypesController],
  providers: [
    FlatRateService,
    IncentiveService,
    ProductTypeService,
    CommissionConfigProvider,
  ],
  // CommissionConfigProvider is exported so Pay Run (later) can read engine config from stored values.
  exports: [CommissionConfigProvider],
})
export class CommissionModule {}
