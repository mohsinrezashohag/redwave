import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { SalesModule } from '../sales/sales.module';
import { ImportController, ImportMappingsController } from './import.controller';
import { ImportService } from './import.service';
import { ParserService } from './parsing/parser.service';

/**
 * ImportModule — the real upload → parse → stage → reconcile → commit pipeline (bulk validation + go-live
 * master/historical migration). Imports SalesModule to DRIVE `SalesService.validateWithinTx`
 * (Import→Sales is one-directional, no cycle) + StorageModule for the source file. Master/historical/
 * back-dated rates are written directly via PrismaService (the #10 path).
 */
@Module({
  imports: [StorageModule, SalesModule],
  controllers: [ImportController, ImportMappingsController],
  providers: [ImportService, ParserService],
})
export class ImportModule {}
