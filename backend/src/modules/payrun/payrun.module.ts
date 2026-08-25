import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { CommissionModule } from '../commission/commission.module';
import { ClawbackModule } from '../clawback/clawback.module';
import { ExpensesModule } from '../expenses/expenses.module';
import {
  PayPeriodController,
  PayRunController,
  PayStatementsController,
  HoldbackLedgerController,
} from './pay-run.controller';
import { PayPeriodService } from './pay-period.service';
import { PayRunService } from './pay-run.service';
import { PayrollExcelRenderer } from './renderers/payroll-excel.renderer';

@Module({
  // Composes the pure engine + the config provider (does not reimplement their logic).
  // ClawbackModule + ExpensesModule supply the real CLAWBACK_TOTAL_PROVIDER / EXPENSE_TOTAL_PROVIDER
  // (re-binding the seams Pay Run left open). Pay Run's own finalize logic is unchanged.
  imports: [EngineModule, CommissionModule, ClawbackModule, ExpensesModule],
  controllers: [PayPeriodController, PayRunController, PayStatementsController, HoldbackLedgerController],
  providers: [PayPeriodService, PayRunService, PayrollExcelRenderer],
  exports: [PayRunService],
})
export class PayRunModule {}
