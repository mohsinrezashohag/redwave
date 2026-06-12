import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { FilesModule } from '../files/files.module';
import { DocumentsController } from './documents.controller';
import { SignatureRequestsController, SignaturesController } from './signature-requests.controller';
import { DocumentsService } from './documents.service';
import { SignaturesService } from './signatures.service';
import { StampService } from './stamp.service';

/**
 * DocumentsModule — real document upload/preview (Supabase storage), the field-placement + e-signature
 * workflow (per-signer status + audit), and server-side pdf-lib stamping (per-signer + final copies). The
 * status rollup/audit/notifications are unchanged. The `NOTIFICATION_EMITTER` seam (signature events →
 * in-app notifications, DOC-006/RPT-009) is supplied by the @Global NotificationsModule — no import here.
 */
@Module({
  imports: [StorageModule, FilesModule],
  controllers: [DocumentsController, SignatureRequestsController, SignaturesController],
  providers: [DocumentsService, SignaturesService, StampService],
})
export class DocumentsModule {}
