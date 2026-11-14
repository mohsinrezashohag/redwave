import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { CommissionModule } from '../commission/commission.module';
import { EngineModule } from '../engine/engine.module';

@Module({
  // Commission + Engine: the export shows each unpaid item's rep rate in force (read only). 2026-11-15
  imports: [CommissionModule, EngineModule],
  controllers: [SalesController],
  providers: [SalesService],
  // Exported so the Import module (later) can drive validation via the same logic.
  exports: [SalesService],
})
export class SalesModule {}
