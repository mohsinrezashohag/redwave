/**
 * LeaderboardService — the company-wide competitiveness ranking by internet activation volume for the
 * period. COUNTS ONLY — the payload carries NO money fields (a peer's activation count is not their
 * earnings), so it is visible to anyone with `reports:view` (incl. reps). — SRS RPT-007, CLAUDE §5
 *
 * The DB filters to the period's confirmed internet activations (same predicate as the dashboards);
 * the per-rep tally is a small reduce over that bounded set. A raw GROUP BY / materialized view is the
 * scale optimization (deferred, §12) — correctness first, identical to the scoped dashboard counts.
 */
import { Injectable, Optional } from '@nestjs/common';
import { AvatarService } from '../../common/avatar/avatar.service';
import { Prisma, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { winnipegDateOnly } from '../../common/timezone';
import { currentPeriod } from './period.logic';

const CONFIRMED: SaleStatus[] = ['validated', 'in_pay_run', 'paid'];

@Injectable()
export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    // Optional so unit tests can build the service without storage; the app always provides it (@Global).
    @Optional() private readonly avatars?: AvatarService,
  ) {}

  async list() {
    const periods = await this.prisma.payPeriod.findMany({
      select: { id: true, period_number: true, start_date: true, end_date: true },
    });
    const period = currentPeriod(periods, winnipegDateOnly()); // "today" in Winnipeg — CLAUDE §11

    const saleWhere: Prisma.SaleWhereInput = {
      status: { in: CONFIRMED },
      ...(period ? { sale_date: { gte: period.start_date, lte: period.end_date } } : {}),
    };
    const items = await this.prisma.saleItem.findMany({
      where: { product_type: 'internet', counts_toward_tally: true, sale: saleWhere },
      select: { sale: { select: { rep_id: true } } },
    });

    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.sale.rep_id, (counts.get(it.sale.rep_id) ?? 0) + 1);

    const reps = await this.prisma.rep.findMany({
      where: { id: { in: [...counts.keys()] } },
      select: { id: true, rep_code: true, full_name: true },
    });
    const repById = new Map(reps.map((r) => [r.id, r]));

    const ranked = [...counts.entries()]
      .map(([rep_id, activation_count]) => ({ rep_id, activation_count }))
      .sort((a, b) => b.activation_count - a.activation_count || a.rep_id.localeCompare(b.rep_id));

    // Each rep's photo (their HR headshot) — a face, never money. 2026-11-12
    const photos = this.avatars ? await this.avatars.resolveReps(ranked.map((r) => r.rep_id)) : new Map<string, string | null>();

    return {
      period: period ? { id: period.id, period_number: period.period_number } : null,
      // COUNTS ONLY — never any commission/earnings field.
      rankings: ranked.map((r, i) => ({
        rank: i + 1,
        rep_id: r.rep_id,
        rep_code: repById.get(r.rep_id)?.rep_code ?? null,
        rep_name: repById.get(r.rep_id)?.full_name ?? null,
        photo_url: photos.get(r.rep_id) ?? null,
        activation_count: r.activation_count,
      })),
    };
  }
}
