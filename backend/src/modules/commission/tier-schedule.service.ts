/**
 * TierScheduleService — the effective-dated tier schedule (a CommissionTierConfig header + its
 * CommissionTier bracket rows). Reuses the shared effective-dating supersession. This module only
 * STORES the schedule; the engine performs tier determination at runtime (#5). — SRS COMM-001, §7.2
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { DomainError } from '../../common/errors/domain-error';
import { deriveStatus, planSupersession, toUtcDateOnly } from '../../common/effective-dating';
import { validateTierBrackets } from './tier-schedule.logic';
import { parseEffectiveWindow } from './effective-dates.util';
import { CreateTierScheduleDto } from './dto/tier.dto';

@Injectable()
export class TierScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Current + pending schedules, each status-annotated. — SRS §7.3 */
  async list() {
    const today = toUtcDateOnly(new Date());
    const headers = await this.prisma.commissionTierConfig.findMany({
      include: { tiers: { orderBy: { tier_number: 'desc' } } },
      orderBy: { effective_from: 'asc' },
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

    const existing = await this.prisma.commissionTierConfig.findMany({
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
}
