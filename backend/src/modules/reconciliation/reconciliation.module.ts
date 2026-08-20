/**
 * ReconciliationModule — finance's read-only tie-out. Imports BillingModule for the live statement re-price
 * AND the live client-expense-document re-derive (billing stream only); reads pay_run_lines + the pure
 * computeNet for the pay-run tie-out. It runs the three checks INDEPENDENTLY and never joins the two rate
 * streams (#3). — arch §6.9
 */
import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [BillingModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
