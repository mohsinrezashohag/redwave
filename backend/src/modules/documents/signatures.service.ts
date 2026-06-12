/**
 * SignaturesService — the signing workflow: a recipient signs/declines their own signature (with real
 * server-side pdf-lib stamping), uploads an externally-signed file, or the requester/owner cancels.
 *
 * On signing, the server stamps the signer's assigned fields onto a DISTINCT per-signer copy of the
 * original (DOC-004) — the original is NEVER mutated (DOC-001). When the request completes, a final copy
 * carrying ALL signatures is produced (DOC-005). The signature image is applied from a saved signature or
 * an inline PNG; date fields auto-fill the signing date; text fields take the typed value. After every
 * action the request + document statuses are recomputed from the live signer rows (pure logic) inside one
 * transaction; the stamping I/O happens OUTSIDE the DB transaction. The signature EVENT (status / method /
 * IP / timestamp) is recorded for the immutable audit (DOC-007).
 *
 * Authorization is ROW-LEVEL (not a module permission): signing is allowed for the recipient of that
 * signature; cancelling for the requester / document owner / admin. — arch §6.10 "any (recipient)"
 */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { BUILTIN_ROLES } from '../../common/rbac/rbac.constants';
import { StorageService, UploadedFile } from '../../common/storage/storage.service';
import { todayInWinnipeg } from '../../common/timezone';
import { SignDto, SignDecision } from './dto/sign.dto';
import { recomputeDocumentStatus, recomputeRequestStatus } from './status.recompute';
import { StampService, StampItem } from './stamp.service';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';

const isAdmin = (user: AuthUser): boolean =>
  user.isSuperAdmin || user.roleNames.includes(BUILTIN_ROLES.ADMIN);

/** Decode a data-URL (or bare base64) into bytes. */
function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  return Buffer.from(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, 'base64');
}

interface FieldRow {
  id: string;
  type: 'signature' | 'initial' | 'date' | 'text';
  page: number;
  x: unknown;
  y: unknown;
  w: unknown;
  h: unknown;
  value_image_path: string | null;
  value_text: string | null;
}

/** Build a stamp item from a field row + its resolved value. */
const toStampItem = (f: FieldRow): StampItem => ({
  box: { page: f.page, x: Number(f.x), y: Number(f.y), w: Number(f.w), h: Number(f.h) },
  imagePath: f.value_image_path,
  text: f.value_text,
});

@Injectable()
export class SignaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly stamp: StampService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
  ) {}

  // ── Sign (stamp) / decline ────────────────────────────────────────────────────────
  async act(requestId: string, dto: SignDto, user: AuthUser, ip: string | undefined) {
    const { request, signature } = await this.loadActable(requestId, user);

    // Decline is a simple status change (no stamping). — terminal
    if (dto.decision === SignDecision.decline) {
      return this.finishAction(requestId, request, signature.id, user, ip, {
        update: { status: 'declined', ip_address: ip ?? null },
        method: null,
        decision: SignDecision.decline,
      });
    }

    // SIGN — resolve the signer's signature image, fill their fields, stamp a per-signer copy.
    const fields = (await this.prisma.signatureField.findMany({
      where: { signature_request_id: requestId, recipient_user_id: user.id },
      select: { id: true, type: true, page: true, x: true, y: true, w: true, h: true, value_image_path: true, value_text: true },
    })) as FieldRow[];

    const needsImage = fields.some((f) => f.type === 'signature' || f.type === 'initial');
    const imagePath = await this.resolveSignatureImagePath(dto, user, needsImage);
    const signingDate = todayInWinnipeg();
    const textById = new Map((dto.field_values ?? []).map((v) => [v.field_id, v.text]));

    // Fill + persist each field's value, then build the stamp list.
    const items: StampItem[] = [];
    for (const f of fields) {
      const value_image_path = f.type === 'signature' || f.type === 'initial' ? imagePath : null;
      const value_text = f.type === 'date' ? signingDate : f.type === 'text' ? textById.get(f.id) ?? '' : null;
      await this.prisma.signatureField.update({ where: { id: f.id }, data: { value_image_path, value_text } });
      items.push(toStampItem({ ...f, value_image_path, value_text }));
    }

    // Per-signer stamped copy (the original is never touched). Null when storage is off — graceful.
    const copy = items.length
      ? await this.stamp.stamp(request.document.original_file_url, `documents/signed/${signature.id}`, items)
      : null;
    const method = dto.method ?? (dto.signature_id ? 'saved' : 'click_to_sign');

    return this.finishAction(requestId, request, signature.id, user, ip, {
      update: {
        status: 'signed',
        signed_at: new Date(),
        ip_address: ip ?? null,
        method,
        signed_file_url: copy?.path ?? null,
      },
      method,
      decision: SignDecision.sign,
    });
  }

  // ── Sign by uploading an externally-signed file (method = uploaded) ──────────────────
  async signUpload(requestId: string, file: UploadedFile, user: AuthUser, ip: string | undefined) {
    const { request, signature } = await this.loadActable(requestId, user);
    const stored = await this.storage.upload(`documents/signed/${signature.id}`, file);
    return this.finishAction(requestId, request, signature.id, user, ip, {
      update: { status: 'signed', signed_at: new Date(), ip_address: ip ?? null, method: 'uploaded', signed_file_url: stored.path },
      method: 'uploaded',
      decision: SignDecision.sign,
    });
  }

  /** Load + row-level-validate the caller's pending signature on a pending request. */
  private async loadActable(requestId: string, user: AuthUser) {
    const request = await this.prisma.signatureRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        document_id: true,
        document: { select: { owner_user_id: true, title: true, original_file_url: true } },
      },
    });
    if (!request) {
      throw new NotFoundException('Signature request not found');
    }
    const signature = await this.prisma.documentSignature.findFirst({
      where: { signature_request_id: requestId, recipient_user_id: user.id },
    });
    if (!signature) {
      throw new ForbiddenException('you are not a recipient of this signature request');
    }
    if (request.status !== 'pending') {
      throw new ConflictException('this signature request is no longer open');
    }
    if (signature.status !== 'pending') {
      throw new ConflictException('you have already responded to this request');
    }
    return { request, signature };
  }

  /** Resolve the signer's signature image to an object path (saved signature or inline PNG). */
  private async resolveSignatureImagePath(dto: SignDto, user: AuthUser, needsImage: boolean): Promise<string | null> {
    if (dto.signature_id) {
      const saved = await this.prisma.userSignature.findFirst({
        where: { id: dto.signature_id, user_id: user.id },
        select: { file_path: true },
      });
      if (!saved) {
        throw new UnprocessableEntityException('saved signature not found');
      }
      return saved.file_path;
    }
    if (dto.signature_image) {
      const stored = await this.storage.uploadBuffer(`signatures/${user.id}/applied`, 'applied.png', decodeDataUrl(dto.signature_image), 'image/png');
      return stored.path;
    }
    if (needsImage) {
      throw new UnprocessableEntityException('a signature is required to sign this document');
    }
    return null;
  }

  /**
   * Commit a sign/decline: update the signer row + recompute statuses (one tx), produce the final
   * all-signatures copy on completion (outside the tx), then audit + notify (unchanged behaviour).
   */
  private async finishAction(
    requestId: string,
    request: { document_id: string; document: { owner_user_id: string; title: string; original_file_url: string } },
    signatureId: string,
    user: AuthUser,
    ip: string | undefined,
    action: { update: Record<string, unknown>; method: string | null; decision: SignDecision },
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.documentSignature.update({ where: { id: signatureId }, data: action.update });
      const requestStatus = await recomputeRequestStatus(tx, requestId);
      const documentStatus = await recomputeDocumentStatus(tx, request.document_id);
      return { requestStatus, documentStatus };
    });

    // On completion, stamp ALL fields (every signer's values) onto the original → final copy (DOC-005).
    if (result.requestStatus === 'completed') {
      const allFields = (await this.prisma.signatureField.findMany({
        where: { signature_request_id: requestId },
        select: { id: true, type: true, page: true, x: true, y: true, w: true, h: true, value_image_path: true, value_text: true },
      })) as FieldRow[];
      const items = allFields.filter((f) => f.value_image_path || f.value_text).map(toStampItem);
      const finalCopy = items.length
        ? await this.stamp.stamp(request.document.original_file_url, `documents/completed/${requestId}`, items)
        : null;
      if (finalCopy) {
        await this.prisma.signatureRequest.update({ where: { id: requestId }, data: { completed_file_path: finalCopy.path } });
      }
    }

    const meta = {
      signatureId,
      documentId: request.document_id,
      ownerId: request.document.owner_user_id,
      documentName: request.document.title,
      requestStatus: result.requestStatus,
      documentStatus: result.documentStatus,
    };

    await this.audit.log({
      actorId: user.id,
      entityType: 'document_signatures',
      entityId: signatureId,
      action: action.decision === SignDecision.sign ? 'sign' : 'decline',
      after: {
        signature_request_id: requestId,
        decision: action.decision,
        method: action.method,
        ip_address: ip ?? null,
        request_status: meta.requestStatus,
        document_status: meta.documentStatus,
        at: new Date().toISOString(),
      },
    });
    if (meta.documentStatus === 'completed') {
      await this.audit.log({
        actorId: user.id,
        entityType: 'documents',
        entityId: meta.documentId,
        action: 'complete',
        after: { status: 'completed' },
      });
    }

    // Notify the document owner (best-effort — never breaks the signing flow). — DOC-006/RPT-009
    const sigVars = { signer_name: user.full_name, document_name: meta.documentName };
    if (action.decision === SignDecision.sign) {
      await this.emitter.emit({
        eventType: 'signature_signed',
        userId: meta.ownerId,
        title: 'A recipient signed your document',
        body: `${user.full_name} signed ${meta.documentName}.`,
        relatedEntityType: 'documents',
        relatedEntityId: meta.documentId,
        variables: sigVars,
      });
    } else {
      await this.emitter.emit({
        eventType: 'signature_declined',
        userId: meta.ownerId,
        title: 'A recipient declined to sign',
        body: `${user.full_name} declined to sign ${meta.documentName}.`,
        relatedEntityType: 'documents',
        relatedEntityId: meta.documentId,
        variables: sigVars,
      });
    }
    if (meta.documentStatus === 'completed') {
      await this.emitter.emit({
        eventType: 'document_completed',
        userId: meta.ownerId,
        title: 'Your document is fully signed',
        body: `${meta.documentName} is complete — all recipients signed.`,
        relatedEntityType: 'documents',
        relatedEntityId: meta.documentId,
        variables: { document_name: meta.documentName },
      });
    }
    return meta;
  }

  // ── Access-controlled URL for a per-signer signed copy (visible to anyone who can see the doc) ──
  async fileUrl(signatureId: string, user: AuthUser): Promise<{ url: string; filename: string }> {
    const sig = await this.prisma.documentSignature.findUnique({
      where: { id: signatureId },
      select: {
        signed_file_url: true,
        signature_request: { select: { document_id: true, document: { select: { owner_user_id: true } } } },
      },
    });
    if (!sig) {
      throw new NotFoundException('signature not found');
    }
    const visible =
      isAdmin(user) ||
      sig.signature_request.document.owner_user_id === user.id ||
      (await this.prisma.documentSignature.count({
        where: { signature_request: { document_id: sig.signature_request.document_id }, recipient_user_id: user.id },
      })) > 0;
    if (!visible) {
      throw new NotFoundException('signature not found'); // no existence leak
    }
    const url = sig.signed_file_url ? await this.storage.signedUrl(sig.signed_file_url) : null;
    if (!url) {
      throw new NotFoundException('no signed copy is available');
    }
    // Signed-URL issuance is audited: who fetched which path, when. — security.md (file storage)
    await this.audit.log({
      actorId: user.id,
      entityType: 'document_signatures',
      entityId: signatureId,
      action: 'download',
      after: { path: sig.signed_file_url },
    });
    return { url, filename: 'signed-copy.pdf' };
  }

  // ── Cancel ──────────────────────────────────────────────────────────────────────
  async cancel(requestId: string, user: AuthUser) {
    const request = await this.prisma.signatureRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        requested_by: true,
        document_id: true,
        document: { select: { owner_user_id: true } },
      },
    });
    if (!request) {
      throw new NotFoundException('Signature request not found');
    }
    if (request.requested_by !== user.id && request.document.owner_user_id !== user.id && !isAdmin(user)) {
      throw new ForbiddenException('only the requester or document owner may cancel this request');
    }
    if (request.status !== 'pending') {
      throw new ConflictException('only a pending request can be cancelled');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.signatureRequest.update({ where: { id: requestId }, data: { status: 'cancelled' } });
      const documentStatus = await recomputeDocumentStatus(tx, request.document_id);
      return { documentStatus };
    });

    await this.audit.log({
      actorId: user.id,
      entityType: 'signature_requests',
      entityId: requestId,
      action: 'cancel',
      after: { status: 'cancelled', document_status: result.documentStatus },
    });
    return { request_id: requestId, status: 'cancelled', document_status: result.documentStatus };
  }
}
