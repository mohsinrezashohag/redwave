/**
 * FilesService — the unified upload pipeline (stored_files + the private Supabase bucket).
 * Upload: validate mime/size (the controller's pipe + a server-side allowlist re-check), build the
 * SERVER-generated path, push the bytes, record metadata (who/what/when + sha256), audit. FAIL-SAFE:
 * storage unconfigured → 503 (`StorageService.assertConfigured`) — never a silent `local://` stub on this
 * pipeline. Returns the row only — downloads are minted per-domain behind the existing RBAC/visibility
 * gates, never from here. — arch §11 / security.md (file storage)
 */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService, UploadedFile } from '../../common/storage/storage.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { BUILTIN_ROLES } from '../../common/rbac/rbac.constants';
import { buildObjectPath, FilePurpose, isAllowedMime, MAX_FILE_BYTES, purposePrefix } from './stored-files.logic';
import { CreateFileDto } from './dto/stored-file.dto';

const isAdmin = (u: AuthUser): boolean => u.isSuperAdmin || u.roleNames.includes(BUILTIN_ROLES.ADMIN);

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async upload(file: UploadedFile, dto: CreateFileDto, user: AuthUser) {
    this.storage.assertConfigured(); // 503 — never a stub reference on this pipeline

    // Re-check beyond the controller pipe (defense in depth; the pipe is the 422 UX).
    if (!isAllowedMime(file.mimetype)) {
      throw new UnprocessableEntityException('only JPEG, PNG, or PDF files are accepted');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new UnprocessableEntityException('the file exceeds the 10 MB limit');
    }

    const path = buildObjectPath(dto.purpose, file.mimetype, new Date(), randomUUID());
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    await this.storage.uploadObject(path, file.buffer, file.mimetype);
    const stored = await this.prisma.storedFile.create({
      data: {
        bucket: this.storage.bucketName,
        path,
        original_name: file.originalname,
        display_name: dto.display_name ?? null,
        mime: file.mimetype,
        size_bytes: file.size,
        sha256,
        uploaded_by: user.id,
      },
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'stored_files',
      entityId: stored.id,
      action: 'upload',
      after: { path, purpose: dto.purpose, mime: file.mimetype, size_bytes: file.size },
    });
    return stored;
  }

  /**
   * CLAIM a previously-uploaded path at use time (an expense item's receipt, a document's original): the
   * path must exist in stored_files, carry the purpose's prefix, and have been uploaded BY THE CALLER
   * (Admin/Super Admin exempt) — an unknown or foreign reference can never be attached to a record (422).
   * One 'unknown reference' message for missing AND foreign paths: no existence leak. Document claims must
   * be PDFs (preserves the DOC-001 422 rule). — security.md (file storage, claim validation)
   */
  async claim(path: string, user: AuthUser, purpose: FilePurpose) {
    const unknown = () =>
      new UnprocessableEntityException(`unknown ${purpose} file reference — upload it via POST /v1/files first`);

    if (!path.startsWith(purposePrefix(purpose))) {
      throw unknown();
    }
    const stored = await this.prisma.storedFile.findUnique({ where: { path } });
    if (!stored || (stored.uploaded_by !== user.id && !isAdmin(user))) {
      throw unknown();
    }
    if (purpose === 'document' && stored.mime !== 'application/pdf') {
      throw new UnprocessableEntityException('a PDF file is required (save Word documents as PDF first)');
    }
    return stored;
  }
}
