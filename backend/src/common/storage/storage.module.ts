/**
 * StorageModule — provides the shared StorageService (Supabase object storage). Imported by any module
 * that uploads files (Expenses receipts now; HRM documents / billing exports later). — arch §11
 */
import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
