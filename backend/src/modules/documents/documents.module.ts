import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { SignatureRequestsController } from './signature-requests.controller';
import { DocumentsService } from './documents.service';
import { SignaturesService } from './signatures.service';

/**
 * DocumentsModule — document upload/share + the e-signature workflow (per-signer status + audit).
 * Binary upload + e-sign provider are STUBBED (file references only). No migration. The
 * `NOTIFICATION_EMITTER` seam (signature events → in-app notifications, DOC-006/RPT-009) is supplied by
 * the @Global NotificationsModule — no import needed here, and no coupling to Reporting feature code.
 */
@Module({
  controllers: [DocumentsController, SignatureRequestsController],
  providers: [DocumentsService, SignaturesService],
})
export class DocumentsModule {}
