/**
 * KmRateService — the per-client, effective-dated kilometre rate (Meeting 3, EXP-004).
 *
 * Two responsibilities:
 *  • resolveRepRate(clientId, date) — the MONEY path: the rep-reimbursement rate in force for the
 *    item's client on its expense_date (client-specific → global → the $0.45 default). Used by
 *    ExpensesService when computing a km item's amount. REP stream only (#3).
 *  • CRUD (list/create/remove) — effective-dated append-new-future-row, reusing the shared supersession
 *    (a future row supersedes the scope's pending row and bounds the current); back-dating is rejected
 *    (protects paid cycles, #10). Scope = (stream, client_id). Pending-only delete re-opens its
 *    predecessor (no gap).
 * — SRS EXP-004 / CLAUDE §3 #3 / #10
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { KmRateStream, Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  dateOnly,
  deriveStatus,
  planSupersession,
  previousDay,
  toUtcDateOnly,
} from '../../common/effective-dating';
import { winnipegDateOnly } from '../../common/timezone';
import { DEFAULT_RATE_PER_KM } from './km.logic';
import { selectKmRate, type KmRateRow } from './km-rate.logic';
import { CreateKmRateDto, ListKmRatesQuery } from './dto/km-rate.dto';

@Injectable()
export class KmRateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The rep-reimbursement rate for (clientId, date). Loads the REP-stream rows for the client scope +
   * the global scope, resolves via the pure selectKmRate, and falls back to the $0.45 constant. This is
   * the value stored on the km log + paid to the rep — exact Decimal, never a float (#1).
   */
  async resolveRepRate(clientId: string | null, date: Date): Promise<Decimal> {
    const rows = await this.prisma.kmRateConfig.findMany({
      where: {
        stream: KmRateStream.rep,
        OR: [{ client_id: null }, ...(clientId ? [{ client_id: clientId }] : [])],
      },
      select: { id: true, client_id: true, rate_per_km: true, effective_from: true, effective_to: true },
    });
    const asRows: KmRateRow[] = rows.map((r) => ({
      id: r.id,
      client_id: r.client_id,
      rate_per_km: r.rate_per_km.toString(),
      effective_from: r.effective_from,
      effective_to: r.effective_to,
    }));
    const picked = selectKmRate(asRows, clientId, date);
    return picked ? new Decimal(picked) : DEFAULT_RATE_PER_KM;
  }

  async list(query: ListKmRatesQuery) {
    const today = toUtcDateOnly(new Date());
    const rows = await this.prisma.kmRateConfig.findMany({
      where: {
        ...(query.stream ? { stream: query.stream } : {}),
        ...(query.client_id ? { client_id: query.client_id } : {}),
      },
      orderBy: [{ stream: 'asc' }, { client_id: 'asc' }, { effective_from: 'asc' }],
    });
    let annotated = rows.map((r) => ({ ...r, status: deriveStatus(r, today) }));
    if (query.status && query.status !== 'all') {
      annotated = annotated.filter((r) => r.status === query.status);
    }
    return annotated;
  }

  /** Append a new effective-dated km rate for a scope (stream, client_id). Back-dating → 422 (#10). */
  async create(dto: CreateKmRateDto, actorId: string) {
    const from = dateOnly(dto.effective_from);
    const to = dto.effective_to ? dateOnly(dto.effective_to) : null;
    const today = winnipegDateOnly(); // canonical Winnipeg "today" (#11)
    if (from.getTime() < today.getTime()) {
      throw new UnprocessableEntityException('effective_from cannot be in the past');
    }
    if (to && to.getTime() < from.getTime()) {
      throw new UnprocessableEntityException('effective_to cannot be before effective_from');
    }
    const clientId = dto.client_id ?? null;
    if (clientId) {
      const client = await this.prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
      if (!client) {
        throw new UnprocessableEntityException('client does not exist');
      }
    }

    const scopeWhere: Prisma.KmRateConfigWhereInput = { stream: dto.stream, client_id: clientId };
    const existing = await this.prisma.kmRateConfig.findMany({
      where: scopeWhere,
      select: { id: true, effective_from: true, effective_to: true },
    });
    const plan = planSupersession(existing, from, today);

    const created = await this.prisma.$transaction(async (tx) => {
      if (plan.deletePendingIds.length > 0) {
        await tx.kmRateConfig.deleteMany({ where: { id: { in: plan.deletePendingIds } } });
      }
      if (plan.boundCurrent) {
        await tx.kmRateConfig.update({
          where: { id: plan.boundCurrent.id },
          data: { effective_to: plan.boundCurrent.effectiveTo },
        });
      }
      return tx.kmRateConfig.create({
        data: {
          stream: dto.stream,
          client_id: clientId,
          rate_per_km: dto.rate_per_km, // decimal STRING → Prisma Decimal
          effective_from: from,
          effective_to: to,
          created_by: actorId,
        },
      });
    });

    await this.audit.log({
      actorId,
      entityType: 'km_rate_config',
      entityId: created.id,
      action: 'create',
      after: {
        stream: dto.stream,
        client_id: clientId,
        rate_per_km: dto.rate_per_km,
        effective_from: dto.effective_from,
        effective_to: dto.effective_to ?? null,
        superseded_pending_ids: plan.deletePendingIds,
        bounded_current_id: plan.boundCurrent?.id ?? null,
      },
    });
    return { ...created, status: deriveStatus(created, today) };
  }

  /** Delete a PENDING km rate; re-open any predecessor it had bounded (no gap). — #10 */
  async remove(id: string, actorId: string) {
    const row = await this.prisma.kmRateConfig.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('KM rate not found');
    }
    const today = toUtcDateOnly(new Date());
    if (deriveStatus(row, today) !== 'pending') {
      throw new UnprocessableEntityException('only a pending km rate can be deleted (supersede a current/past one instead)');
    }
    const predecessorEnd = previousDay(row.effective_from);
    await this.prisma.$transaction(async (tx) => {
      await tx.kmRateConfig.delete({ where: { id } });
      await tx.kmRateConfig.updateMany({
        where: { stream: row.stream, client_id: row.client_id, effective_to: predecessorEnd },
        data: { effective_to: null },
      });
    });
    await this.audit.log({ actorId, entityType: 'km_rate_config', entityId: id, action: 'delete', before: row });
  }
}
