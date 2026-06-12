/**
 * FilesModule — the unified upload pipeline (POST /v1/files + stored_files metadata + claim validation).
 * Exports FilesService so consuming domains (expenses receipts, document originals) claim uploaded paths
 * at use time. Storage is the shared common/storage StorageService (private Supabase bucket).
 */
import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [StorageModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
