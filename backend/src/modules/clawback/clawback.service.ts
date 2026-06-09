/**
 * ClawbackService — recover a cancelled, already-PAID activation. A clawback is a FLAT, per-item
 * deduction whose amount is the exact amount originally paid, READ from the frozen `sale_item`
 * snapshot via the engine's pure calc. It creates a NEW record and never edits the snapshot (#2),
 * never re-tiers the period (#5), and does NO date math (#6). — SRS §10 (CLAW-001..006)
 */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { CommissionEngineService } from '../engine/commission-engine.service';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';
import { CreateClawbackDto } from './dto/create-clawback.dto';
import { ListClawbacksQuery } from './dto/list-clawbacks.query';

const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const dec = (value: { toString(): string }): Decimal => new Decimal(value.toString());

@Injectable()
export class ClawbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly engine: CommissionEngineService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
  ) {}

  async enter(dto: CreateClawbackDto, user: AuthUser) {
    const item = await this.prisma.saleItem.findUnique({
      where: { id: dto.sale_item_id },
      select: {
        id: true,
        item_status: true,
        rate_applied: true,
        incentive_amount: true,
        commission_paid: true,
        sale: { select: { id: true, rep_id: true } },
      },
    });
    if (!item) {
      throw new NotFoundException('Sale item not found');
    }
    // Can only claw back a PAID item — its snapshot was frozen at finalize (commission_paid set). (#2)
    if (item.commission_paid === null || item.rate_applied === null) {
      throw new UnprocessableEntityException(
        'can only claw back a paid item with a frozen snapshot',
      );
    }
    // One clawback per item; other items on the same sale may still be clawed back independently (§16).
    if (item.item_status === 'clawed_back') {
      throw new ConflictException('this item has already been clawed back');
    }
    const existing = await this.prisma.clawback.findFirst({ where: { sale_item_id: item.id } });
    if (existing) {
      throw new ConflictException('a clawback already exists for this item');
    }

    await this.assertRepInScope(user, item.sale.rep_id);

    // Amount = the exact amount paid (rate + incentive), via the engine's pure calc from the snapshot.
    const computed = this.engine.computeClawbackAmount({
      rateApplied: dec(item.rate_applied),
      incentiveAmount: item.incentive_amount === null ? undefined : dec(item.incentive_amount),
    });
    const amount = dto.amount ? new Decimal(dto.amount) : computed;

    const created = await this.prisma.$transaction(async (tx) => {
      const clawback = await tx.clawback.create({
        data: {
          sale_item_id: item.id,
          sale_id: item.sale.id,
          rep_id: item.sale.rep_id,
          amount: amount.toFixed(2),
          reason: dto.reason,
          reported_date: dateOnly(dto.reported_date), // stored only — no date logic (#6)
          entered_by: user.id,
          status: 'pending', // pending until applied in a pay run
        },
      });
      // Mark the item + sale clawed_back (§16 Paid→Clawed Back). Snapshot fields are NOT touched (#2).
      await tx.saleItem.update({ where: { id: item.id }, data: { item_status: 'clawed_back' } });
      await tx.sale.update({ where: { id: item.sale.id }, data: { status: 'clawed_back' } });
      return clawback;
    });

    await this.audit.log({
      actorId: user.id,
      entityType: 'clawbacks',
      entityId: created.id,
      action: 'create',
      after: {
        sale_item_id: item.id,
        rep_id: item.sale.rep_id,
        amount: amount.toFixed(2),
        reported_date: dto.reported_date,
        status: 'pending',
      },
    });
    // Best-effort: notify the affected rep a clawback was recorded. — clawback_applied
    const rep = await this.prisma.rep.findUnique({ where: { id: item.sale.rep_id }, select: { user_id: true } });
    await this.emitter.emitMany([rep?.user_id], {
      eventType: 'clawback_applied',
      title: 'A clawback was applied',
      body: `A clawback of ${amount.toFixed(2)} was applied: ${dto.reason}.`,
      relatedEntityType: 'clawbacks',
      relatedEntityId: created.id,
      variables: { amount: amount.toFixed(2), reason: dto.reason },
    });
    return created;
  }

  async list(query: ListClawbacksQuery, user: AuthUser) {
    const repIds = await this.scopeRepIds(user);
    const and: Prisma.ClawbackWhereInput[] = [];
    if (repIds !== null) and.push({ rep_id: { in: repIds } }); // scope in the query (§5)
    if (query.rep_id) and.push({ rep_id: query.rep_id });
    if (query.status) and.push({ status: query.status });
    if (query.sale_id) and.push({ sale_id: query.sale_id });
    return this.prisma.clawback.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string, user: AuthUser) {
    const repIds = await this.scopeRepIds(user);
    const clawback = await this.prisma.clawback.findFirst({
      where: { id, ...(repIds ? { rep_id: { in: repIds } } : {}) },
    });
    if (!clawback) {
      throw new NotFoundException('Clawback not found');
    }
    return clawback;
  }

  private async scopeRepIds(user: AuthUser): Promise<string[] | null> {
    const scope = await this.scope.getRepScope(user);
    return scope.level === 'all' ? null : scope.repIds;
  }

  private async assertRepInScope(user: AuthUser, repId: string): Promise<void> {
    const repIds = await this.scopeRepIds(user);
    if (repIds === null || repIds.includes(repId)) {
      return;
    }
    await this.audit.log({
      actorId: user.id,
      entityType: 'clawbacks',
      entityId: repId,
      action: 'access_denied',
      after: { reason: 'rep out of scope', rep_id: repId },
    });
    throw new ForbiddenException('you are not permitted to enter clawbacks for this rep');
  }
}
