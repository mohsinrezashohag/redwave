/**
 * BillingRatesService — effective-dated CLIENT billing rates (what Redwave charges the client).
 *
 * SEPARATE STREAM from rep commission rates: this service touches ONLY client_billing_rates and
 * never joins/reads the commission_* tables. — CLAUDE §3 #3 (the prior system's core defect)
 *
 * Adding a future-dated rate supersedes the scope's pending rate and bounds the current one; closed
 * periods are never altered; back-dating is rejected. — SRS CLNT-004/005, CLAUDE #10. Money is exact
 * Decimal (amount arrives as a validated decimal STRING, stored as Prisma Decimal — never float, #1).
 */
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ClientBillingRate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';
import { CreateBillingRateDto, ListBillingRatesQuery } from './dto/billing-rate.dto';
import {
  dateOnly,
  deriveStatus,
  planSupersession,
  RateStatus,
  selectEffectiveRate,
} from './billing-rate.logic';
import { winnipegDateOnly } from '../../common/timezone';

type RateWithStatus = ClientBillingRate & { status: RateStatus };

@Injectable()
export class BillingRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
  ) {}

  async create(
    clientId: string,
    dto: CreateBillingRateDto,
    actorId: string,
  ): Promise<RateWithStatus> {
    await this.assertClientExists(clientId);

    const productId = dto.product_id ?? null;
    // A 'product' rate must target a product; add-on kinds may be client-wide (product_id null).
    if (dto.rate_kind === 'product' && !productId) {
      throw new UnprocessableEntityException('rate_kind "product" requires a product_id');
    }
    if (productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: productId, client_id: clientId },
        select: { id: true },
      });
      if (!product) {
        throw new UnprocessableEntityException('product_id does not belong to this client');
      }
    }

    const effectiveFrom = dateOnly(dto.effective_from);
    const effectiveTo = dto.effective_to ? dateOnly(dto.effective_to) : null;
    const today = winnipegDateOnly(); // canonical Winnipeg "today" — CLAUDE §11
    if (effectiveFrom.getTime() < today.getTime()) {
      throw new UnprocessableEntityException('effective_from cannot be in the past'); // #10
    }
    if (effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
      throw new UnprocessableEntityException('effective_to cannot be before effective_from');
    }

    // Existing rows for the SAME scope (client + product + rate_kind). product_id null → IS NULL.
    const existing = await this.prisma.clientBillingRate.findMany({
      where: { client_id: clientId, product_id: productId, rate_kind: dto.rate_kind },
      select: { id: true, effective_from: true, effective_to: true },
    });
    const plan = planSupersession(existing, effectiveFrom, today);

    const created = await this.prisma.$transaction(async (tx) => {
      if (plan.deletePendingIds.length > 0) {
        await tx.clientBillingRate.deleteMany({ where: { id: { in: plan.deletePendingIds } } });
      }
      if (plan.boundCurrent) {
        await tx.clientBillingRate.update({
          where: { id: plan.boundCurrent.id },
          data: { effective_to: plan.boundCurrent.effectiveTo },
        });
      }
      return tx.clientBillingRate.create({
        data: {
          client_id: clientId,
          product_id: productId,
          rate_kind: dto.rate_kind,
          amount: dto.amount, // decimal STRING → Prisma Decimal (exact; never float)
          effective_from: effectiveFrom,
          effective_to: effectiveTo,
          created_by: actorId,
        },
      });
    });

    await this.audit.log({
      actorId,
      entityType: 'client_billing_rates',
      entityId: created.id,
      action: 'create',
      after: {
        client_id: clientId,
        product_id: productId,
        rate_kind: dto.rate_kind,
        amount: dto.amount,
        effective_from: dto.effective_from,
        effective_to: dto.effective_to ?? null,
        superseded_pending_ids: plan.deletePendingIds,
        bounded_current_id: plan.boundCurrent?.id ?? null,
      },
    });

    // Best-effort: notify Admins/Super Admins of the rate change (in-app only by default, RPT-010). — rate_change
    const client = await this.prisma.client.findUnique({ where: { id: clientId }, select: { client_code: true } });
    const rateEvent = {
      eventType: 'rate_change' as const,
      title: 'Billing rate changed',
      body: `A ${dto.rate_kind} rate for ${client?.client_code ?? 'a client'} changed.`,
      relatedEntityType: 'client_billing_rates',
      relatedEntityId: created.id,
      variables: { client_code: client?.client_code ?? '', rate_kind: dto.rate_kind },
    };
    await this.emitter.emitRole('Admin', rateEvent);
    await this.emitter.emitRole('Super Admin', rateEvent);

    return { ...created, status: deriveStatus(created, today) };
  }

  /** List the client's rates, each annotated past/current/pending. With `effectiveOn`, returns the
   *  single rate in force per scope on that date. Optional product/kind/status filters. */
  async list(clientId: string, query: ListBillingRatesQuery): Promise<RateWithStatus[]> {
    await this.assertClientExists(clientId);
    const today = winnipegDateOnly(); // canonical Winnipeg "today" — CLAUDE §11

    const rates = await this.prisma.clientBillingRate.findMany({
      where: {
        client_id: clientId,
        ...(query.productId ? { product_id: query.productId } : {}),
        ...(query.rateKind ? { rate_kind: query.rateKind } : {}),
      },
      orderBy: [{ rate_kind: 'asc' }, { effective_from: 'asc' }],
    });

    if (query.effectiveOn) {
      const date = dateOnly(query.effectiveOn);
      const effective: RateWithStatus[] = [];
      for (const scopeRates of this.groupByScope(rates).values()) {
        const inForce = selectEffectiveRate(scopeRates, date);
        if (inForce) {
          effective.push({ ...inForce, status: deriveStatus(inForce, today) });
        }
      }
      return effective;
    }

    let annotated = rates.map((r) => ({ ...r, status: deriveStatus(r, today) }));
    if (query.status && query.status !== 'all') {
      annotated = annotated.filter((r) => r.status === query.status);
    }
    return annotated;
  }

  /** Group rates by scope key (product_id + rate_kind) so selection is per-scope. */
  private groupByScope(rates: ClientBillingRate[]): Map<string, ClientBillingRate[]> {
    const groups = new Map<string, ClientBillingRate[]>();
    for (const rate of rates) {
      const key = `${rate.product_id ?? 'null'}|${rate.rate_kind}`;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(rate);
      } else {
        groups.set(key, [rate]);
      }
    }
    return groups;
  }

  private async assertClientExists(clientId: string): Promise<void> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
  }
}
