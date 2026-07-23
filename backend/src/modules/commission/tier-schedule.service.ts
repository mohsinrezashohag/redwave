/**
 * TierScheduleService — the effective-dated tier schedule (a CommissionTierConfig header + its
 * CommissionTier bracket rows). Reuses the shared effective-dating supersession. This module only
 * STORES the schedule; the engine performs tier determination at runtime (#5). — SRS COMM-001, §7.2
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { DomainError } from '../../common/errors/domain-error';
import { deriveStatus, planSupersession, previousDay, toUtcDateOnly } from '../../common/effective-dating';
import { validateTierBrackets } from './tier-schedule.logic';
import { parseEffectiveWindow } from './effective-dates.util';
import { assertPending, resolveEditWindow } from './effective-edit.util';
import { scopeWhere } from './client-scope.logic';
import { resolveClientScope } from './client-scope.util';
import {
  CreateTierScheduleDto,
  ListTierSchedulesQuery,
  TierBracketDto,
  UpdateTierScheduleDto,
} from './dto/tier.dto';

@Injectable()
export class TierScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Schedules, each status-annotated. `client_id` selects the scope: a client id for that client's own
   * ladder, or `null` for the GLOBAL one (the fallback used by any client without its own). Omit to list
   * every scope. — SRS §7.3
   */
  async list(query: ListTierSchedulesQuery = {}) {
    const today = toUtcDateOnly(new Date());
    const headers = await this.prisma.commissionTierConfig.findMany({
      where: scopeWhere(query.client_id),
      include: { tiers: { orderBy: { tier_number: 'desc' } } },
      orderBy: [{ client_id: 'asc' }, { effective_from: 'asc' }],
    });
    return headers.map((h) => ({ ...h, status: deriveStatus(h, today) }));
  }

  async create(dto: CreateTierScheduleDto, actorId: string) {
    // Normalize optional max_count → null, then validate (contiguous, one open top bracket; else 422).
    // validateTierBrackets is a PURE/mirrored module that throws a bare Error — wrap it here (the service
    // boundary) as a DomainError so the global filter maps it to 422; the pure module stays framework-free.
    try {
      validateTierBrackets(
        dto.tiers.map((t) => ({
          tier_number: t.tier_number,
          min_count: t.min_count,
          max_count: t.max_count ?? null,
        })),
      );
    } catch (e) {
      throw new DomainError('TIER_SCHEDULE_INVALID', (e as Error).message);
    }
    const { from, to, today } = parseEffectiveWindow(dto.effective_from, dto.effective_to);
    // null = the GLOBAL ladder. Supersession is per SCOPE: a client's schedule must never bound or
    // supersede the global one (or another client's) — they are independent effective-dated streams.
    const clientId = await resolveClientScope(this.prisma, dto.client_id);

    const existing = await this.prisma.commissionTierConfig.findMany({
      where: { client_id: clientId },
      select: { id: true, effective_from: true, effective_to: true },
    });
    const plan = planSupersession(existing, from, today);

    const created = await this.prisma.$transaction(async (tx) => {
      if (plan.deletePendingIds.length > 0) {
        // No cascade in the schema — delete child tier rows before their headers.
        await tx.commissionTier.deleteMany({
          where: { tier_config_id: { in: plan.deletePendingIds } },
        });
        await tx.commissionTierConfig.deleteMany({ where: { id: { in: plan.deletePendingIds } } });
      }
      if (plan.boundCurrent) {
        await tx.commissionTierConfig.update({
          where: { id: plan.boundCurrent.id },
          data: { effective_to: plan.boundCurrent.effectiveTo },
        });
      }
      return tx.commissionTierConfig.create({
        data: {
          client_id: clientId,
          effective_from: from,
          effective_to: to,
          created_by: actorId,
          tiers: {
            create: dto.tiers.map((t) => ({
              tier_number: t.tier_number,
              min_count: t.min_count,
              max_count: t.max_count ?? null,
              rate_per_activation: t.rate_per_activation, // decimal STRING → Prisma Decimal
            })),
          },
        },
        include: { tiers: { orderBy: { tier_number: 'desc' } } },
      });
    });

    await this.audit.log({
      actorId,
      entityType: 'commission_tier_configs',
      entityId: created.id,
      action: 'create',
      after: {
        effective_from: dto.effective_from,
        effective_to: dto.effective_to ?? null,
        tiers: dto.tiers.map((t) => ({
          tier_number: t.tier_number,
          min_count: t.min_count,
          max_count: t.max_count ?? null,
          rate_per_activation: t.rate_per_activation,
        })),
        superseded_pending_ids: plan.deletePendingIds,
        bounded_current_id: plan.boundCurrent?.id ?? null,
      },
    });
    return { ...created, status: deriveStatus(created, today) };
  }

  /**
   * Edit a PENDING schedule: its effective window and/or the full bracket set (re-validated, replaced).
   * A current/past schedule is immutable (supersede instead). — #10
   */
  async update(id: string, dto: UpdateTierScheduleDto, actorId: string) {
    const row = await this.prisma.commissionTierConfig.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Tier schedule not found');
    }
    assertPending(row);
    if (dto.tiers) {
      this.assertValidBrackets(dto.tiers);
    }
    const { from, to, today } = resolveEditWindow(row, dto);

    // Same SCOPE only — client_id is immutable on edit (like rate_kind/product_type elsewhere).
    const others = await this.prisma.commissionTierConfig.findMany({
      where: { client_id: row.client_id, id: { not: id } },
      select: { id: true, effective_from: true, effective_to: true },
    });
    const plan = planSupersession(others, from, today);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (plan.deletePendingIds.length > 0) {
        await tx.commissionTier.deleteMany({ where: { tier_config_id: { in: plan.deletePendingIds } } });
        await tx.commissionTierConfig.deleteMany({ where: { id: { in: plan.deletePendingIds } } });
      }
      if (plan.boundCurrent) {
        await tx.commissionTierConfig.update({
          where: { id: plan.boundCurrent.id },
          data: { effective_to: plan.boundCurrent.effectiveTo },
        });
      }
      if (dto.tiers) {
        // Replace the bracket set (no cascade — delete children first).
        await tx.commissionTier.deleteMany({ where: { tier_config_id: id } });
        await tx.commissionTier.createMany({
          data: dto.tiers.map((t) => ({
            tier_config_id: id,
            tier_number: t.tier_number,
            min_count: t.min_count,
            max_count: t.max_count ?? null,
            rate_per_activation: t.rate_per_activation,
          })),
        });
      }
      return tx.commissionTierConfig.update({
        where: { id },
        data: { effective_from: from, effective_to: to },
        include: { tiers: { orderBy: { tier_number: 'desc' } } },
      });
    });

    await this.audit.log({ actorId, entityType: 'commission_tier_configs', entityId: id, action: 'update', before: row, after: updated });
    return { ...updated, status: deriveStatus(updated, today) };
  }

  /** Delete a PENDING schedule (+ its bracket rows); re-open any predecessor it had bounded. — #10 */
  async remove(id: string, actorId: string) {
    const row = await this.prisma.commissionTierConfig.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Tier schedule not found');
    }
    assertPending(row);
    const predecessorEnd = previousDay(row.effective_from);
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionTier.deleteMany({ where: { tier_config_id: id } });
      await tx.commissionTierConfig.delete({ where: { id } });
      // Scope-bound: without client_id this would re-open EVERY scope's row ending on that date,
      // silently resurrecting another client's (or the global) superseded schedule.
      await tx.commissionTierConfig.updateMany({
        where: { client_id: row.client_id, effective_to: predecessorEnd },
        data: { effective_to: null },
      });
    });
    await this.audit.log({ actorId, entityType: 'commission_tier_configs', entityId: id, action: 'delete', before: row });
  }

  /** Validate the bracket set (contiguous, one open top bracket); wrap the pure throw as a 422 DomainError. */
  private assertValidBrackets(tiers: TierBracketDto[]): void {
    try {
      validateTierBrackets(
        tiers.map((t) => ({ tier_number: t.tier_number, min_count: t.min_count, max_count: t.max_count ?? null })),
      );
    } catch (e) {
      throw new DomainError('TIER_SCHEDULE_INVALID', (e as Error).message);
    }
  }
}
