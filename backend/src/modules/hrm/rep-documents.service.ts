/**
 * RepDocumentsService — rep documents (contracts, IDs). The file is uploaded to object storage (the row
 * keeps the object PATH); bytes are served only via an hrm:edit-gated /file-url (short-TTL signed URL).
 * Identity docs are sensitive: the file ref is redacted from view-only callers. — SRS HRM-005/008, arch §11
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { StorageService, UploadedFile } from '../../common/storage/storage.service';
import { todayInWinnipeg } from '../../common/timezone';
import { canSeeSensitive } from './reps.service';
import { CreateRepDocumentDto, UpdateRepDocumentDatesDto } from './dto/rep-document.dto';
import { DocumentReaderService } from './document-reader.service';
import { EXPIRING_DOC_TYPES, repDocumentProblem } from './rep-documents.logic';
import { idDocumentChecks, type IdCheck } from './id-document.logic';

export interface DocumentReadResult {
  issued_on: string | null;
  expires_on: string | null;
  name_on_document: string | null;
  checks: IdCheck[];
}

/** The stored object's type, from its extension (rep documents keep the original name's extension). */
export function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

@Injectable()
export class RepDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly reader: DocumentReaderService,
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
        issued_on: dto.issued_on ? new Date(`${dto.issued_on}T00:00:00.000Z`) : null,
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

  // ── Reading dates off an ID (2026-11-12) ─────────────────────────────────────────────────────
  // The reader's output is a SUGGESTION returned to HR; nothing read is stored or logged. Only the dates HR
  // confirms are saved (create / updateDates). The audit row says a read happened and which fields were
  // found — never the values, the name or the image.

  /** Read a file that is about to be uploaded (nothing is stored). */
  async readUpload(repId: string, docType: string, file: UploadedFile, actorId: string): Promise<DocumentReadResult> {
    const repName = await this.repName(repId);
    return this.readAndCheck(repId, null, docType, file.buffer, file.mimetype, repName, actorId);
  }

  /** Read a document already on file (e.g. one uploaded before dates were captured). */
  async readStored(repId: string, docId: string, actorId: string): Promise<DocumentReadResult> {
    const repName = await this.repName(repId);
    const doc = await this.prisma.repDocument.findFirst({ where: { id: docId, rep_id: repId }, select: { doc_type: true, file_url: true } });
    if (!doc) throw new NotFoundException('Document not found');
    if (!EXPIRING_DOC_TYPES.has(doc.doc_type)) {
      throw new UnprocessableEntityException('Only permits, PR cards, driver’s licences and passports can be read for dates');
    }
    const bytes = await this.storage.download(doc.file_url);
    if (!bytes) throw new UnprocessableEntityException('The file isn’t available to read. Enter the dates by hand.');
    return this.readAndCheck(repId, docId, doc.doc_type, bytes, mimeFromPath(doc.file_url), repName, actorId);
  }

  /** HR saves confirmed dates on an existing document. `null` clears a date; omitted = unchanged. */
  async updateDates(repId: string, docId: string, dto: UpdateRepDocumentDatesDto, actorId: string) {
    const doc = await this.prisma.repDocument.findFirst({ where: { id: docId, rep_id: repId } });
    if (!doc) throw new NotFoundException('Document not found');
    const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const next = {
      issued_on: dto.issued_on === undefined ? iso(doc.issued_on) : dto.issued_on,
      expires_on: dto.expires_on === undefined ? iso(doc.expires_on) : dto.expires_on,
    };
    const problem = repDocumentProblem(doc.doc_type, 'application/pdf', next.expires_on, next.issued_on);
    if (problem) throw new UnprocessableEntityException(problem);
    const toDate = (v: string | null) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
    const updated = await this.prisma.repDocument.update({
      where: { id: docId },
      data: { issued_on: toDate(next.issued_on), expires_on: toDate(next.expires_on) },
    });
    await this.audit.log({
      actorId,
      entityType: 'rep_documents',
      entityId: docId,
      action: 'update',
      before: { issued_on: iso(doc.issued_on), expires_on: iso(doc.expires_on) },
      after: next,
    });
    return updated;
  }

  private async readAndCheck(
    repId: string,
    docId: string | null,
    docType: string,
    bytes: Buffer,
    mimetype: string,
    repName: string,
    actorId: string,
  ): Promise<DocumentReadResult> {
    if (!EXPIRING_DOC_TYPES.has(docType)) {
      throw new UnprocessableEntityException('Only permits, PR cards, driver’s licences and passports can be read for dates');
    }
    const read = await this.reader.read(bytes, mimetype, docType);
    const checks = idDocumentChecks(read, repName, todayInWinnipeg());
    await this.audit.log({
      actorId,
      entityType: 'rep_documents',
      entityId: docId ?? repId,
      action: 'document_read',
      after: {
        rep_id: repId,
        doc_type: docType,
        found: { issued_on: !!read.issued_on, expires_on: !!read.expires_on, name: !!read.name_on_document, mrz: !!read.mrz_lines },
      },
    });
    return { issued_on: read.issued_on, expires_on: read.expires_on, name_on_document: read.name_on_document, checks };
  }

  private async repName(repId: string): Promise<string> {
    const rep = await this.prisma.rep.findUnique({ where: { id: repId }, select: { full_name: true } });
    if (!rep) throw new NotFoundException('Rep not found');
    return rep.full_name;
  }

  private async assertRepExists(repId: string): Promise<void> {
    const rep = await this.prisma.rep.findUnique({ where: { id: repId }, select: { id: true } });
    if (!rep) {
      throw new NotFoundException('Rep not found');
    }
  }
}
