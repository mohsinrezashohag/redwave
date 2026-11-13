/**
 * RepDocumentsService — rep documents (contracts, IDs). The file is uploaded to object storage (the row
 * keeps the object PATH); bytes are served only via an hrm:edit-gated /file-url (short-TTL signed URL).
 * Identity docs are sensitive: the file ref is redacted from view-only callers. — SRS HRM-005/008, arch §11
 *
 * 2026-11-12: edit (type + dates), replace the file, and DELETE as a 30-day soft delete ("Recently deleted").
 * Every live read filters `deleted_at: null` (LIVE); a deleted document can't be opened, read or edited until
 * it is restored. RepDocumentPurgeService removes the object + row once the 30 days are up.
 */
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { StorageService, UploadedFile } from '../../common/storage/storage.service';
import { todayInWinnipeg } from '../../common/timezone';
import { canSeeSensitive } from './reps.service';
import { CreateRepDocumentDto, ReplaceRepDocumentDto, UpdateRepDocumentDto } from './dto/rep-document.dto';
import { DocumentReaderService } from './document-reader.service';
import { EXPIRING_DOC_TYPES, isRestorable, purgeDueDate, repDocumentProblem } from './rep-documents.logic';
import { idDocumentChecks, namesMatch, withMrzDetails, type IdCheck } from './id-document.logic';
import { encryptField, loadFieldKey } from '../../common/crypto/field-cipher';
import { RepDocument } from '@prisma/client';

/** Live documents only. A document in Recently deleted is invisible to every normal read. */
const LIVE = { deleted_at: null } as const;

const toDay = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const CLEARED_ID_DETAILS = { name_on_document: null, date_of_birth: null, document_number_ciphertext: null, document_number_last4: null };

export interface DocumentReadResult {
  issued_on: string | null;
  expires_on: string | null;
  name_on_document: string | null;
  date_of_birth: string | null;
  document_number: string | null;
  checks: IdCheck[];
}

/** The HR-confirmed ID details a document create / edit / replace may carry (2026-11-13). */
export interface IdDetailsInput {
  name_on_document?: string | null;
  date_of_birth?: string | null;
  document_number?: string | null;
}

const maskDocNumber = (last4: string | null) => (last4 ? `••••${last4}` : null);

/**
 * A document as any response carries it: the encrypted document number never leaves the server (only its
 * mask does), and the identity details are nulled for a caller who can't see sensitive data. — HRM-008
 */
export function toDocView<T extends RepDocument>(doc: T, canSee: boolean) {
  const { document_number_ciphertext: _cipher, document_number_last4, ...rest } = doc;
  void _cipher;
  return {
    ...rest,
    file_url: canSee ? rest.file_url : null,
    name_on_document: canSee ? rest.name_on_document : null,
    date_of_birth: canSee ? rest.date_of_birth : null,
    document_number_masked: canSee ? maskDocNumber(document_number_last4) : null,
  };
}

/** A field of the Data accuracy comparison. `match` null = nothing to compare (a missing value is no mismatch). */
export interface AccuracyCell {
  value: string | null;
  match: boolean | null;
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
  private readonly piiKey = loadFieldKey();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly reader: DocumentReaderService,
  ) {}

  async list(repId: string, user: AuthUser) {
    await this.assertRepExists(repId);
    const docs = await this.prisma.repDocument.findMany({
      where: { rep_id: repId, ...LIVE },
      orderBy: { uploaded_at: 'desc' },
    });
    const canSee = canSeeSensitive(user);
    // Hide the file reference and identity details from view-only callers; metadata stays visible. — HRM-008
    return docs.map((doc) => toDocView(doc, canSee));
  }

  async create(repId: string, dto: CreateRepDocumentDto, file: UploadedFile, actorId: string) {
    await this.assertRepExists(repId);
    const stored = await this.storage.upload('rep-docs', file); // returns the object PATH (or local:// ref)
    const doc = await this.prisma.repDocument.create({
      data: {
        rep_id: repId,
        doc_type: dto.doc_type,
        file_url: stored.path,
        expires_on: toDay(dto.expires_on),
        issued_on: toDay(dto.issued_on),
        ...this.idDetailsData(dto.doc_type, dto),
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
    return toDocView(doc, true);
  }

  /** A short-TTL signed URL for a rep document (the controller gates this on hrm:edit). */
  async fileUrl(repId: string, docId: string): Promise<{ url: string; filename: string }> {
    const doc = await this.prisma.repDocument.findFirst({
      where: { id: docId, rep_id: repId, ...LIVE },
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
  // confirms are saved (create / update). The audit row says a read happened and which fields were
  // found — never the values, the name or the image.

  /** Read a file that is about to be uploaded (nothing is stored). */
  async readUpload(repId: string, docType: string, file: UploadedFile, actorId: string): Promise<DocumentReadResult> {
    const repName = await this.repName(repId);
    return this.readAndCheck(repId, null, docType, file.buffer, file.mimetype, repName, actorId);
  }

  /** Read a document already on file (e.g. one uploaded before dates were captured). */
  async readStored(repId: string, docId: string, actorId: string): Promise<DocumentReadResult> {
    const repName = await this.repName(repId);
    const doc = await this.prisma.repDocument.findFirst({ where: { id: docId, rep_id: repId, ...LIVE }, select: { doc_type: true, file_url: true } });
    if (!doc) throw new NotFoundException('Document not found');
    if (!EXPIRING_DOC_TYPES.has(doc.doc_type)) {
      throw new UnprocessableEntityException('Only permits, PR cards, driver’s licences and passports can be read for dates');
    }
    const bytes = await this.storage.download(doc.file_url);
    if (!bytes) throw new UnprocessableEntityException('The file isn’t available to read. Enter the dates by hand.');
    return this.readAndCheck(repId, docId, doc.doc_type, bytes, mimeFromPath(doc.file_url), repName, actorId);
  }

  /**
   * Edit a document on file: its type and, for IDs, the HR-confirmed dates. `null` clears a date; omitted =
   * unchanged; a type without dates clears them. A headshot must stay a JPG/PNG (checked against the stored file).
   */
  async update(repId: string, docId: string, dto: UpdateRepDocumentDto, actorId: string) {
    const doc = await this.liveDoc(repId, docId);
    const docType = dto.doc_type ?? doc.doc_type;
    const keepsDates = EXPIRING_DOC_TYPES.has(docType);
    const next = {
      doc_type: docType,
      // Sent → used (and checked); omitted → kept, or cleared when the new type carries no dates.
      issued_on: dto.issued_on !== undefined ? dto.issued_on : keepsDates ? isoDay(doc.issued_on) : null,
      expires_on: dto.expires_on !== undefined ? dto.expires_on : keepsDates ? isoDay(doc.expires_on) : null,
    };
    const problem = repDocumentProblem(next.doc_type, mimeFromPath(doc.file_url), next.expires_on, next.issued_on);
    if (problem) throw new UnprocessableEntityException(problem);
    const updated = await this.prisma.repDocument.update({
      where: { id: docId },
      data: {
        doc_type: next.doc_type,
        issued_on: toDay(next.issued_on),
        expires_on: toDay(next.expires_on),
        ...(keepsDates ? this.idDetailsData(next.doc_type, dto) : CLEARED_ID_DETAILS),
      },
    });
    await this.audit.log({
      actorId,
      entityType: 'rep_documents',
      entityId: docId,
      action: 'update',
      before: { doc_type: doc.doc_type, issued_on: isoDay(doc.issued_on), expires_on: isoDay(doc.expires_on) },
      // The identity details are never logged; only whether they changed.
      after: { ...next, id_details_changed: dto.name_on_document !== undefined || dto.date_of_birth !== undefined || dto.document_number !== undefined },
    });
    return toDocView(updated, true);
  }

  /**
   * Replace the file: the new upload becomes the live document (same type), and the old one moves to Recently
   * deleted in the same transaction, so a wrong replacement can be undone for 30 days. Omitted dates carry over.
   */
  async replaceFile(repId: string, docId: string, dto: ReplaceRepDocumentDto, file: UploadedFile, actorId: string) {
    const old = await this.liveDoc(repId, docId);
    const issued = dto.issued_on ?? isoDay(old.issued_on);
    const expires = dto.expires_on ?? isoDay(old.expires_on);
    const problem = repDocumentProblem(old.doc_type, file.mimetype, expires, issued);
    if (problem) throw new UnprocessableEntityException(problem);
    const stored = await this.storage.upload('rep-docs', file);
    const now = new Date();
    const [created] = await this.prisma.$transaction([
      this.prisma.repDocument.create({
        data: {
          rep_id: repId,
          doc_type: old.doc_type,
          file_url: stored.path,
          issued_on: toDay(issued),
          expires_on: toDay(expires),
          // A new file is a new reading: details the operator confirmed now, else the old ones carry over.
          name_on_document: dto.name_on_document ?? old.name_on_document,
          date_of_birth: dto.date_of_birth ? toDay(dto.date_of_birth) : old.date_of_birth,
          ...(dto.document_number
            ? this.idDetailsData(old.doc_type, { document_number: dto.document_number })
            : { document_number_ciphertext: old.document_number_ciphertext, document_number_last4: old.document_number_last4 }),
        },
      }),
      this.prisma.repDocument.update({ where: { id: old.id }, data: { deleted_at: now, deleted_by: actorId } }),
    ]);
    await this.audit.log({
      actorId,
      entityType: 'rep_documents',
      entityId: created.id,
      action: 'replace',
      after: { rep_id: repId, doc_type: old.doc_type, replaced: old.id, stored: stored.stored },
    });
    return toDocView(created, true);
  }

  /** Move a document to Recently deleted. It stays restorable for 30 days, then the purge removes it for good. */
  async remove(repId: string, docId: string, actorId: string): Promise<{ success: true; purge_on: string }> {
    const doc = await this.liveDoc(repId, docId);
    const now = new Date();
    await this.prisma.repDocument.update({ where: { id: doc.id }, data: { deleted_at: now, deleted_by: actorId } });
    // The type only, never the path (identity docs are sensitive).
    await this.audit.log({
      actorId,
      entityType: 'rep_documents',
      entityId: doc.id,
      action: 'delete',
      after: { rep_id: repId, doc_type: doc.doc_type },
    });
    return { success: true, purge_on: purgeDueDate(now).toISOString() };
  }

  /** Recently deleted: what can still be restored, newest first, with who deleted it and when it goes for good. */
  async listDeleted(repId: string) {
    await this.assertRepExists(repId);
    const docs = await this.prisma.repDocument.findMany({
      where: { rep_id: repId, deleted_at: { not: null } },
      orderBy: { deleted_at: 'desc' },
      include: { deleter: { select: { full_name: true } } },
    });
    // A deleted file can't be opened, so its storage path is never returned.
    return docs.map(({ deleter, ...doc }) => ({
      ...toDocView(doc, false),
      deleted_by_name: deleter?.full_name ?? null,
      purge_on: purgeDueDate(doc.deleted_at as Date).toISOString(),
    }));
  }

  /** Bring a document back from Recently deleted, while the 30 days last. */
  async restore(repId: string, docId: string, actorId: string, now: Date = new Date()) {
    const doc = await this.prisma.repDocument.findFirst({
      where: { id: docId, rep_id: repId, deleted_at: { not: null } },
    });
    if (!doc || !doc.deleted_at) throw new NotFoundException('Document not found in Recently deleted');
    if (!isRestorable(doc.deleted_at, now)) {
      throw new ConflictException('This document was deleted more than 30 days ago and can no longer be restored');
    }
    const restored = await this.prisma.repDocument.update({
      where: { id: doc.id },
      data: { deleted_at: null, deleted_by: null },
    });
    await this.audit.log({
      actorId,
      entityType: 'rep_documents',
      entityId: doc.id,
      action: 'restore',
      after: { rep_id: repId, doc_type: doc.doc_type },
    });
    return toDocView(restored, true);
  }

  private async liveDoc(repId: string, docId: string) {
    const doc = await this.prisma.repDocument.findFirst({ where: { id: docId, rep_id: repId, ...LIVE } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
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
    const today = todayInWinnipeg();
    const read = withMrzDetails(await this.reader.read(bytes, mimetype, docType), today);
    const rep = await this.prisma.rep.findUnique({ where: { id: repId }, select: { date_of_birth: true } });
    const checks = idDocumentChecks(read, repName, today, isoDay(rep?.date_of_birth ?? null));
    await this.audit.log({
      actorId,
      entityType: 'rep_documents',
      entityId: docId ?? repId,
      action: 'document_read',
      after: {
        rep_id: repId,
        doc_type: docType,
        found: {
          issued_on: !!read.issued_on,
          expires_on: !!read.expires_on,
          name: !!read.name_on_document,
          date_of_birth: !!read.date_of_birth,
          document_number: !!read.document_number,
          mrz: !!read.mrz_lines,
        },
      },
    });
    return {
      issued_on: read.issued_on,
      expires_on: read.expires_on,
      name_on_document: read.name_on_document,
      date_of_birth: read.date_of_birth ?? null,
      document_number: read.document_number ?? null,
      checks,
    };
  }

  /**
   * DATA ACCURACY (2026-11-13): the rep's profile beside the HR-confirmed details of their latest LIVE ID of each
   * kind, field by field, like the passport office's comparison table. Values only ever come from what HR
   * confirmed; a value missing on either side is "not on file", never a mismatch. hrm:edit (controller).
   */
  async dataAccuracy(repId: string) {
    const rep = await this.prisma.rep.findUnique({
      where: { id: repId },
      select: { full_name: true, date_of_birth: true, address_street: true, address_city: true, address_province: true, address_postal: true },
    });
    if (!rep) throw new NotFoundException('Rep not found');
    const docs = await this.prisma.repDocument.findMany({
      where: { rep_id: repId, ...LIVE, doc_type: { in: [...EXPIRING_DOC_TYPES] } },
      orderBy: { uploaded_at: 'desc' },
    });
    const latest = new Map<string, RepDocument>();
    for (const d of docs) if (!latest.has(d.doc_type)) latest.set(d.doc_type, d);

    const profileDob = isoDay(rep.date_of_birth);
    const address = [rep.address_street, rep.address_city, rep.address_province, rep.address_postal].filter(Boolean).join(', ');
    const sources = [...latest.values()].map((d) => {
      const name = d.name_on_document;
      const dob = isoDay(d.date_of_birth);
      return {
        document_id: d.id,
        doc_type: d.doc_type,
        name: { value: name, match: name ? namesMatch(name, rep.full_name) : null },
        date_of_birth: { value: dob, match: dob && profileDob ? dob === profileDob : null },
        document_number: { value: maskDocNumber(d.document_number_last4), match: null },
        issued_on: { value: isoDay(d.issued_on), match: null },
        expires_on: { value: isoDay(d.expires_on), match: null },
        expired: !!d.expires_on && isoDay(d.expires_on)! < todayInWinnipeg(),
      };
    });
    const differences = sources.reduce(
      (n, s) => n + (s.name.match === false ? 1 : 0) + (s.date_of_birth.match === false ? 1 : 0),
      0,
    );
    return {
      profile: { name: rep.full_name, date_of_birth: profileDob, address: address || null },
      sources,
      differences,
    };
  }

  /** The identity-detail columns to write. Only IDs carry them; the document number is encrypted. */
  private idDetailsData(docType: string, dto: IdDetailsInput) {
    if (!EXPIRING_DOC_TYPES.has(docType)) return {};
    const out: Record<string, unknown> = {};
    if (dto.name_on_document !== undefined) out.name_on_document = dto.name_on_document?.trim() || null;
    if (dto.date_of_birth !== undefined) out.date_of_birth = toDay(dto.date_of_birth);
    if (dto.document_number !== undefined) {
      const n = dto.document_number?.replace(/\s+/g, '').toUpperCase() || null;
      if (n && !this.piiKey) {
        throw new UnprocessableEntityException('Document numbers can’t be stored until PII_ENCRYPTION_KEY is configured.');
      }
      out.document_number_ciphertext = n ? encryptField(n, this.piiKey!) : null;
      out.document_number_last4 = n ? n.slice(-4) : null;
    }
    return out;
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
