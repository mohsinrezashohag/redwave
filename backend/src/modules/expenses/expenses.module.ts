import { Module } from '@nestjs/common';
import { EXPENSE_TOTAL_PROVIDER } from '../payrun/seams/expense-total.provider';
import { StorageModule } from '../../common/storage/storage.module';
import { FilesModule } from '../files/files.module';
import {
  ExpenseItemsController,
  ExpenseFieldConfigsController,
  ExpenseExportsController,
} from './expenses.controller';
import { ExpenseReportsController } from './expense-report.controller';
import { KmRateController } from './km-rate.controller';
import { ExpenseSettingsController } from './expense-settings.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseReportsService } from './expense-report.service';
import { FieldConfigService } from './field-config.service';
import { ExpenseExportService } from './expense-export.service';
import { KmRateService } from './km-rate.service';
import { ExpenseSettingsService } from './expense-settings.service';
import { ExpensePayrunProvider } from './expense-payrun.provider';
import { MapsService } from './maps.service';

@Module({
  imports: [StorageModule, FilesModule],
  controllers: [
    ExpenseItemsController,
    ExpenseReportsController,
    ExpenseFieldConfigsController,
    ExpenseExportsController,
    KmRateController,
    ExpenseSettingsController,
  ],
  providers: [
    ExpensesService,
    ExpenseReportsService,
    FieldConfigService,
    ExpenseExportService,
    KmRateService,
    ExpenseSettingsService,
    MapsService,
    ExpensePayrunProvider,
    // The REAL implementation of the Pay Run expense seam — re-binds the token Pay Run left at zero.
    { provide: EXPENSE_TOTAL_PROVIDER, useExisting: ExpensePayrunProvider },
  ],
  // Exported so PayRunModule imports this module to satisfy EXPENSE_TOTAL_PROVIDER.
  exports: [EXPENSE_TOTAL_PROVIDER],
})
export class ExpensesModule {}
