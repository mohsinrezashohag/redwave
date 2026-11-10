/**
 * MarginService — per-sale margin: what the client was billed, what the rep was paid, and the spread.
 *
 * ⚠ THIS MODULE DELIBERATELY CROSSES INVARIANT #3, AND IT IS THE ONLY PLACE THAT MAY.
 *
 * The two rate streams are kept apart everywhere else because joining them was the previous system's core
 * defect — a client rate leaking into a commission calculation, or vice versa, produces wrong money that
 * nothing detects. Redwave's earning IS the difference between them, so a margin view has to put them on
 * one row. Packet 07 sanctions that under conditions this file honours exactly:
 *
 *   1. READ-ONLY, and only here in `reporting/`. No margin code in billing/, payrun/, engine/ or
 *      commission/.
 *   2. NO Prisma relation between the streams. The two sides are queried SEPARATELY and joined in memory
 *      on `sale_id`. Adding a relation "to make the query cleaner" would silently remove the guard the
 *      whole system rests on, and nothing would fail loudly when it did.
 *   3. It NEVER feeds pricing. No value computed here may become an input to a rate, a commission, or a
 *      document. It is a read for humans.
 *
 * Both sides are FROZEN wide lines (#2) — `client_statement_lines` from an issued statement, and
 * `payroll_report_lines` from a finalized pay run. Nothing is re-priced or recomputed; the margin is a
 * subtraction of two numbers that were already committed.
 *
 * #12 — CURRENCY. A statement line is denominated in its document's currency, and only the document TOTAL
 * has a frozen `amount_cad`; per-line CAD is not stored. Rather than re-converting (which #12 forbids),
 * every row carries its currency and roll-ups are grouped BY currency, so nothing is ever summed across
 * two of them. A foreign client's margin is reported in that client's currency, honestly labelled.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

const dec = (v: { toString(): string } | null | undefined): Decimal => new Decimal((v ?? 0).toString());
const money = (v: Decimal): string => v.toFixed(2);

export interface MarginRow {
  sale_id: string;
  sale_date: string | null;
  client_code: string | null;
  customer_name: string;
  product_name: string | null;
  rep_code: string | null;
  rep_name: string | null;
  /** The document currency this row is denominated in. Never mixed with another (#12). */
  currency: string;
  /** What the CLIENT was billed — the frozen statement line total. */
  client_billed: string;
  /** What the REP earned — the frozen payroll line total at 100%. */
  rep_paid: string;
  /** client_billed − rep_paid. Negative is shown, never hidden. */
  margin: string;
  /** Margin as a percentage of what the client was billed; null when the bill is zero. */
  margin_pct: string | null;
}

export interface MarginGroup {
  key: string;
  label: string;
  currency: string;
  client_billed: string;
  rep_paid: string;
  margin: string;
  margin_pct: string | null;
  sale_count: number;
}

@Injectable()
export class MarginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Margin is commercially sensitive — it exposes what Redwave earns on every sale. Super Admin only, and
   * a denial is audited like any other. Packet 07: "gate it away from rep-facing roles entirely."
   */
  private async assertSuperAdmin(user: AuthUser): Promise<void> {
    if (user.isSuperAdmin) return;
    await this.audit.log({
      actorId: user.id,
      entityType: 'reports',
      entityId: 'margin',
      action: 'access_denied',
      after: { reason: 'per-sale margin is Super Admin only' },
    });
    throw new ForbiddenException('Margin reporting is Super Admin only');
  }

  /**
   * Per-sale margin over a date range.
   *
   * THE JOIN SITE — #3. Two independent reads, joined in memory on `sale_id`. Each query touches exactly
   * one stream: the first reads only client-billing tables, the second only rep-pay tables. Neither knows
   * the other exists, and there is no database relation between them. Sanctioned by packet 07 for this
   * read alone — do not treat it as precedent.
   */
  async perSale(user: AuthUser, from: string, to: string, clientId?: string): Promise<MarginRow[]> {
    await this.assertSuperAdmin(user);
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);

    // ── Stream A: the CLIENT bill. Frozen statement lines from ISSUED statements only — a superseded
    //    version is a historical artifact, not what the client owes.
    const billed = await this.prisma.clientStatementLine.findMany({
      where: {
        sale_date: { gte: start, lte: end },
        statement: {
          status: 'issued',
          ...(clientId ? { client_id: clientId } : {}),
        },
      },
      select: {
        sale_id: true,
        sale_date: true,
        customer_name: true,
        product_name: true,
        channel: true,
        rep_code: true,
        rep_name: true,
        line_total: true,
        statement: { select: { currency: true } },
      },
    });

    // ── Stream B: the REP pay. Frozen payroll lines, written at finalize (#2). Read separately, keyed by
    //    sale, with NO reference to anything above.
    const paid = await this.prisma.payrollReportLine.findMany({
      where: { sale_date: { gte: start, lte: end } },
      select: { sale_id: true, total_100: true },
    });
    const paidBySale = new Map(paid.map((p) => [p.sale_id, dec(p.total_100)]));

    const rows: MarginRow[] = billed.map((b) => {
      const clientBilled = dec(b.line_total);
      // A sale billed but not yet paid contributes zero rep cost — correct, not missing: the rep genuinely
      // has not been paid for it yet. The UI labels those rows so the margin is not read as final.
      const repPaid = paidBySale.get(b.sale_id) ?? new Decimal(0);
      const margin = clientBilled.minus(repPaid);
      return {
        sale_id: b.sale_id,
        sale_date: b.sale_date ? b.sale_date.toISOString().slice(0, 10) : null,
        client_code: b.channel,
        customer_name: b.customer_name,
        product_name: b.product_name,
        rep_code: b.rep_code,
        rep_name: b.rep_name,
        currency: b.statement?.currency ?? 'CAD',
        client_billed: money(clientBilled),
        rep_paid: money(repPaid),
        margin: money(margin),
        margin_pct: clientBilled.isZero() ? null : margin.div(clientBilled).times(100).toFixed(1),
      };
    });

    return rows.sort((a, b) => (a.sale_date ?? '').localeCompare(b.sale_date ?? '') || a.sale_id.localeCompare(b.sale_id));
  }

  /**
   * Roll up per-sale margin by product, client or rep.
   *
   * Grouped BY CURRENCY as well as by the chosen dimension, so two currencies are never added together
   * (#12). A client billing in USD appears as its own group rather than being folded into a CAD total at
   * a rate nobody froze.
   */
  async rollup(
    user: AuthUser,
    from: string,
    to: string,
    by: 'product' | 'client' | 'rep',
    clientId?: string,
  ): Promise<MarginGroup[]> {
    const rows = await this.perSale(user, from, to, clientId);
    const keyOf = (r: MarginRow): { key: string; label: string } => {
      if (by === 'product') return { key: r.product_name ?? '(no product)', label: r.product_name ?? '(no product)' };
      if (by === 'client') return { key: r.client_code ?? '(unknown)', label: r.client_code ?? '(unknown)' };
      return { key: r.rep_code ?? '(unknown)', label: r.rep_name ?? r.rep_code ?? '(unknown)' };
    };

    const groups = new Map<string, MarginGroup & { _billed: Decimal; _paid: Decimal }>();
    for (const r of rows) {
      const { key, label } = keyOf(r);
      // Currency is part of the key — that is what stops a USD row landing in a CAD total.
      const composite = `${key}::${r.currency}`;
      const existing = groups.get(composite);
      const billed = dec(r.client_billed);
      const paid = dec(r.rep_paid);
      if (existing) {
        existing._billed = existing._billed.plus(billed);
        existing._paid = existing._paid.plus(paid);
        existing.sale_count += 1;
      } else {
        groups.set(composite, {
          key: composite,
          label,
          currency: r.currency,
          client_billed: '0.00',
          rep_paid: '0.00',
          margin: '0.00',
          margin_pct: null,
          sale_count: 1,
          _billed: billed,
          _paid: paid,
        });
      }
    }

    return [...groups.values()]
      .map((g) => {
        const margin = g._billed.minus(g._paid);
        return {
          key: g.key,
          label: g.label,
          currency: g.currency,
          client_billed: money(g._billed),
          rep_paid: money(g._paid),
          margin: money(margin),
          margin_pct: g._billed.isZero() ? null : margin.div(g._billed).times(100).toFixed(1),
          sale_count: g.sale_count,
        };
      })
      .sort((a, b) => dec(b.margin).comparedTo(dec(a.margin)));
  }

  /**
   * RATES IN FORCE — the client rate and the rep rate side by side for a date, with their effective dates.
   *
   * Same #3 treatment: two separate reads, joined in memory on the PRODUCT. This answers "what are we
   * charging and what are we paying for this product right now", which is the question the per-sale view
   * cannot answer for a product that has not sold yet.
   *
   * The rep side reports the tier LADDER rate and any per-product override, because a rep's internet rate
   * depends on the period's volume — there is no single number, and pretending otherwise would misinform.
   */
  async ratesInForce(user: AuthUser, on: string, clientId?: string) {
    await this.assertSuperAdmin(user);
    const date = new Date(`${on}T00:00:00.000Z`);
    const inForce = { effective_from: { lte: date }, OR: [{ effective_to: null }, { effective_to: { gte: date } }] };

    // ── Stream A: client billing rates.
    const clientRates = await this.prisma.clientBillingRate.findMany({
      where: { ...inForce, rate_kind: 'product', ...(clientId ? { client_id: clientId } : {}) },
      select: {
        product_id: true,
        amount: true,
        effective_from: true,
        effective_to: true,
        client: { select: { client_code: true, currency: true } },
        product: { select: { name: true, product_type: true } },
      },
    });

    // ── Stream B: rep rates. Per-product tier overrides and per-product/type flat rates — read separately.
    const tierRates = await this.prisma.commissionTierRate.findMany({
      where: inForce,
      select: { product_id: true, tier_number: true, amount: true },
    });
    const flatRates = await this.prisma.commissionFlatRate.findMany({
      where: inForce,
      select: { product_id: true, product_type: true, amount: true },
    });

    const tiersByProduct = new Map<string, { tier_number: number; amount: string }[]>();
    for (const t of tierRates) {
      const list = tiersByProduct.get(t.product_id) ?? [];
      list.push({ tier_number: t.tier_number, amount: dec(t.amount).toFixed(2) });
      tiersByProduct.set(t.product_id, list);
    }
    const flatByProduct = new Map(flatRates.filter((f) => f.product_id).map((f) => [f.product_id!, dec(f.amount).toFixed(2)]));
    const flatByType = new Map(flatRates.filter((f) => !f.product_id).map((f) => [f.product_type, dec(f.amount).toFixed(2)]));

    return clientRates.map((c) => ({
      product_id: c.product_id,
      product_name: c.product?.name ?? '(unknown)',
      product_type: c.product?.product_type ?? null,
      client_code: c.client?.client_code ?? null,
      currency: c.client?.currency ?? 'CAD',
      client_rate: dec(c.amount).toFixed(2),
      client_rate_from: c.effective_from.toISOString().slice(0, 10),
      client_rate_to: c.effective_to ? c.effective_to.toISOString().slice(0, 10) : null,
      // A tiered product has no single rep rate — it depends on the period's volume, so every bracket is
      // reported rather than one number that would be right only sometimes.
      rep_tier_rates: c.product_id ? (tiersByProduct.get(c.product_id) ?? []).sort((a, b) => a.tier_number - b.tier_number) : [],
      rep_flat_rate:
        (c.product_id ? flatByProduct.get(c.product_id) : undefined) ??
        (c.product?.product_type ? flatByType.get(c.product.product_type) : undefined) ??
        null,
    }));
  }
}
