/**
 * RepDocumentsService — rep documents (contracts, IDs). The file is uploaded to object storage (the row
 * keeps the object PATH); bytes are served only via an hrm:edit-gated /file-url (short-TTL signed URL).
 * Identity docs are sensitive: the file ref is redacted from view-only callers. — SRS HRM-005/008, arch §11
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { StorageService, UploadedFile } from '../../common/storage/storage.service';
import { canSeeSensitive } from './reps.service';
import { CreateRepDocumentDto } from './dto/rep-document.dto';

@Injectable()
export class RepDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async list(repId: string, user: AuthUser) {
    await this.assertRepExists(repId);
    const docs = await this.prisma.repDocument.findMany({
      where: { rep_id: repId },
      orderBy: { uploaded_at: 'desc' },
    });
    const canSee = canSeeSensitive(user);
    // Hide the file reference from view-only callers; metadata stays visible. — HRM-008
    return docs.map((doc) => (canSee ? doc : { ...doc, file_url: null }));
  }

  async create(repId: string, dto: CreateRepDocumentDto, file: UploadedFile, actorId: string) {
    await this.assertRepExists(repId);
    const stored = await this.storage.upload('rep-docs', file); // returns the object PATH (or local:// ref)
    const doc = await this.prisma.repDocument.create({
      data: {
        rep_id: repId,
        doc_type: dto.doc_type,
        file_url: stored.path,
        expires_on: dto.expires_on ? new Date(`${dto.expires_on}T00:00:00.000Z`) : null,
      },
    });
    // Do not log file_url (identity docs are sensitive).
    await this.audit.log({
      actorId,
      entityType: 'rep_documents',
      entityId: doc.id,
      action: 'create',
      after: { rep_id: repId, doc_type: doc.doc_type, stored: stored.stored },
    });
    return doc;
  }

  /** A short-TTL signed URL for a rep document (the controller gates this on hrm:edit). */
  async fileUrl(repId: string, docId: string): Promise<{ url: string; filename: string }> {
    const doc = await this.prisma.repDocument.findFirst({
      where: { id: docId, rep_id: repId },
      select: { doc_type: true, file_url: true },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    const url = await this.storage.signedUrl(doc.file_url);
    if (!url) {
      throw new NotFoundException('the document file is not available (storage not configured)');
    }
    return { url, filename: doc.doc_type };
  }

  private async assertRepExists(repId: string): Promise<void> {
    const rep = await this.prisma.rep.findUnique({ where: { id: repId }, select: { id: true } });
    if (!rep) {
      throw new NotFoundException('Rep not found');
    }
  }
}
