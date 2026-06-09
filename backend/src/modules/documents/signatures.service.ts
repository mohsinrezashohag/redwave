/**
 * SignaturesService — the signing workflow: a recipient signs/declines their own signature, or the
 * requester/owner cancels a request. After every action the request + document statuses are
 * recomputed from the live signer rows (pure logic), all inside one transaction so the signer-update
 * and the rollup are atomic. The e-signature PROVIDER is STUBBED (a `signed_file_url` reference is
 * minted); the signature EVENT (status/method/IP/timestamp) is recorded for audit. — SRS DOC-003/004/005
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
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { BUILTIN_ROLES } from '../../common/rbac/rbac.constants';
import { SignDto, SignDecision } from './dto/sign.dto';
import { recomputeDocumentStatus, recomputeRequestStatus } from './status.recompute';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';

const isAdmin = (user: AuthUser): boolean =>
  user.isSuperAdmin || user.roleNames.includes(BUILTIN_ROLES.ADMIN);

@Injectable()
export class SignaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
  ) {}

  // ── Sign / decline ──────────────────────────────────────────────────────────────
  async act(requestId: string, dto: SignDto, user: AuthUser, ip: string | undefined) {
    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.signatureRequest.findUnique({
        where: { id: requestId },
        select: { id: true, status: true, document_id: true, document: { select: { owner_user_id: true, title: true } } },
      });
      if (!request) {
        throw new NotFoundException('Signature request not found');
      }
      // The caller may only act on THEIR OWN signature row in this request. — row-level authz
      const signature = await tx.documentSignature.findFirst({
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

      const signing = dto.decision === SignDecision.sign;
      await tx.documentSignature.update({
        where: { id: signature.id },
        data: signing
          ? {
              status: 'signed',
              signed_at: new Date(),
              ip_address: ip ?? null,
              method: dto.method ?? 'click_to_sign',
              // STUB: distinct signed copy per signer (DOC-004); the original is never touched.
              signed_file_url: `s3://redwave-docs/signed/${signature.id}.pdf`,
            }
          : { status: 'declined', ip_address: ip ?? null },
      });

      const requestStatus = await recomputeRequestStatus(tx, requestId);
      const documentStatus = await recomputeDocumentStatus(tx, request.document_id);
      return {
        signatureId: signature.id,
        documentId: request.document_id,
        ownerId: request.document.owner_user_id,
        documentName: request.document.title,
        requestStatus,
        documentStatus,
      };
    });

    await this.audit.log({
      actorId: user.id,
      entityType: 'document_signatures',
      entityId: result.signatureId,
      action: dto.decision === SignDecision.sign ? 'sign' : 'decline',
      after: {
        signature_request_id: requestId,
        decision: dto.decision,
        method: dto.method ?? (dto.decision === SignDecision.sign ? 'click_to_sign' : null),
        ip_address: ip ?? null,
        request_status: result.requestStatus,
        document_status: result.documentStatus,
        at: new Date().toISOString(),
      },
    });
    // A document reaching 'completed' is itself an auditable milestone (DOC-005).
    if (result.documentStatus === 'completed') {
      await this.audit.log({
        actorId: user.id,
        entityType: 'documents',
        entityId: result.documentId,
        action: 'complete',
        after: { status: 'completed' },
      });
    }

    // Notify the document owner (best-effort — never breaks the signing flow). — DOC-006/RPT-009
    const sigVars = { signer_name: user.full_name, document_name: result.documentName };
    if (dto.decision === SignDecision.sign) {
      await this.emitter.emit({
        eventType: 'signature_signed',
        userId: result.ownerId,
        title: 'A recipient signed your document',
        body: `${user.full_name} signed ${result.documentName}.`,
        relatedEntityType: 'documents',
        relatedEntityId: result.documentId,
        variables: sigVars,
      });
    } else {
      await this.emitter.emit({
        eventType: 'signature_declined',
        userId: result.ownerId,
        title: 'A recipient declined to sign',
        body: `${user.full_name} declined to sign ${result.documentName}.`,
        relatedEntityType: 'documents',
        relatedEntityId: result.documentId,
        variables: sigVars,
      });
    }
    if (result.documentStatus === 'completed') {
      await this.emitter.emit({
        eventType: 'document_completed',
        userId: result.ownerId,
        title: 'Your document is fully signed',
        body: `${result.documentName} is complete — all recipients signed.`,
        relatedEntityType: 'documents',
        relatedEntityId: result.documentId,
        variables: { document_name: result.documentName },
      });
    }
    return result;
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
