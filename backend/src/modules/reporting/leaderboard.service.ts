/**
 * LeaderboardService — the company-wide competitiveness ranking by internet activation volume for the
 * period. Each rep carries TWO counts (client meeting 2026-11-16, "show both the pending and approved
 * sales counts"): `approved_count` (confirmed: validated / in_pay_run / paid) and `pending_count`
 * (entered, awaiting validation). `activation_count` stays equal to `approved_count` for older consumers.
 * Ranked by approved, then pending; a rep with only pending sales is listed too.
 *
 * COUNTS ONLY — the payload carries NO money fields (a peer's activation count is not their earnings), so
 * it is visible to anyone with `reports:view` (incl. reps). — SRS RPT-007, CLAUDE §5
 *
 * The DB filters to the period's internet activations that count toward the tally (same predicate as the
 * dashboards); the per-rep tally is a small reduce over that bounded set. A raw GROUP BY / materialized
 * view is the scale optimization (deferred, §12).
 */
import { Injectable, Optional } from '@nestjs/common';
import { AvatarService } from '../../common/avatar/avatar.service';
import { Prisma, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { winnipegDateOnly } from '../../common/timezone';
import { currentPeriod } from './period.logic';

const CONFIRMED: SaleStatus[] = ['validated', 'in_pay_run', 'paid'];
const PENDING: SaleStatus[] = ['entered'];

interface RepTally {
  approved: number;
  pending: number;
}

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
    const period = currentPeriod(periods, winnipegDateOnly()); // "today" in Winnipeg — CLAUDE §2

    const saleWhere: Prisma.SaleWhereInput = {
      status: { in: [...CONFIRMED, ...PENDING] },
      ...(period ? { sale_date: { gte: period.start_date, lte: period.end_date } } : {}),
    };
    const items = await this.prisma.saleItem.findMany({
      where: { product_type: 'internet', counts_toward_tally: true, sale: saleWhere },
      select: { sale: { select: { rep_id: true, status: true } } },
    });

    const counts = new Map<string, RepTally>();
    for (const it of items) {
      const t = counts.get(it.sale.rep_id) ?? { approved: 0, pending: 0 };
      if (PENDING.includes(it.sale.status)) t.pending += 1;
      else t.approved += 1;
      counts.set(it.sale.rep_id, t);
    }

    const reps = await this.prisma.rep.findMany({
      where: { id: { in: [...counts.keys()] } },
      select: { id: true, rep_code: true, full_name: true },
    });
    const repById = new Map(reps.map((r) => [r.id, r]));

    // Approved first (the competitive number); pending breaks ties; rep id keeps it deterministic.
    const ranked = [...counts.entries()]
      .map(([rep_id, t]) => ({ rep_id, approved_count: t.approved, pending_count: t.pending }))
      .sort(
        (a, b) =>
          b.approved_count - a.approved_count ||
          b.pending_count - a.pending_count ||
          a.rep_id.localeCompare(b.rep_id),
      );

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
        approved_count: r.approved_count,
        pending_count: r.pending_count,
        activation_count: r.approved_count, // back-compat alias of approved_count
      })),
    };
  }
}
