import { Module } from '@nestjs/common';
import { EXPENSE_TOTAL_PROVIDER } from '../payrun/seams/expense-total.provider';
import {
  ExpenseItemsController,
  ExpenseFieldConfigsController,
  ExpenseExportsController,
} from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { FieldConfigService } from './field-config.service';
import { ExpenseExportService } from './expense-export.service';
import { ExpensePayrunProvider } from './expense-payrun.provider';
import { MapsService } from './maps.service';

@Module({
  controllers: [ExpenseItemsController, ExpenseFieldConfigsController, ExpenseExportsController],
  providers: [
    ExpensesService,
    FieldConfigService,
    ExpenseExportService,
    MapsService,
    ExpensePayrunProvider,
    // The REAL implementation of the Pay Run expense seam — re-binds the token Pay Run left at zero.
    { provide: EXPENSE_TOTAL_PROVIDER, useExisting: ExpensePayrunProvider },
  ],
  // Exported so PayRunModule imports this module to satisfy EXPENSE_TOTAL_PROVIDER.
  exports: [EXPENSE_TOTAL_PROVIDER],
})
export class ExpensesModule {}
