/**
 * StatementService — generates the CLIENT STATEMENT (what Redwave bills the program partner) for a
 * client + pay period, and exposes the priced draft for the invoice to reuse.
 *
 * Priced **SOLELY** from `client_billing_rates` (effective-dated by each sale's `sale_date`, #7/#10)
 * via the shared `selectEffectiveRate`. There is **NO** code path here that reads `commission_*`
 * tables or the engine — the two rate streams never mix (#3, the prior system's core defect). The
 * module computes no commission and freezes nothing (read-only over sales × billing rates).
 *
 * One line per SALE (= one customer/household; its items are the products) — SRS BILL-001. Money is
 * exact Decimal, never float (#1). No GST anywhere (BILL-004). Owns client_statements + _lines.
 */
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';
import { selectEffectiveRate } from '../../common/effective-dating';
import { formatMoney } from '../../common/money/money';
import { winnipegDateOnly } from '../../common/timezone';
import { FxRateService } from '../../common/fx/fx-rate.service';
import { convertToCad } from '../../common/fx/fx.logic';
import { SequenceService } from '../../common/sequence/sequence.service';
import { statementNo } from './doc-number';
import { buildStatement, SaleInput, StatementDraft } from './statement.logic';

/** The FX snapshot frozen onto a billing document AT ISSUE (#12). */
export interface IssueFx {
  currency: string;
  fx_rate: string; // 8-dp decimal string; '1.00000000' for CAD
  fx_rate_date: Date;
  amount_cad: string; // = roundHalfUp(total × fx_rate)
}

/** Prisma.Decimal → decimal.js (billing stream only; never the commission engine's path, #3). */
const toDecimal = (value: Prisma.Decimal): Decimal => new Decimal(value.toString());

interface BillingRateRow {
  id: string;
  product_id: string | null;
  effective_from: Date;
  effective_to: Date | null;
  amount: Prisma.Decimal;
}

interface PricedContext {
  client: { id: string; client_code: string; currency: string };
  period: { id: string; period_number: number };
  draft: StatementDraft;
}

const STATEMENT_INCLUDE = { lines: true } as const;

@Injectable()
export class StatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
    private readonly fx: FxRateService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
  ) {}

  /**
   * The FX snapshot to freeze on a document AT ISSUE (#12). CAD → rate 1 (no fetch). Foreign → the issuer's
   * override, else the Bank of Canada rate, else 422 (never guess). Reused by statement + invoice generate.
   */
  async resolveIssueFx(currency: string, total: Decimal, fxOverride?: string): Promise<IssueFx> {
    const freezeDate = winnipegDateOnly();
    let rate: Decimal;
    if (currency === 'CAD') {
      rate = new Decimal(1);
    } else {
      const resolved =
        fxOverride != null ? new Decimal(fxOverride) : await this.fx.getRateToCad(currency, freezeDate);
      if (resolved === null) {
        throw new UnprocessableEntityException(
          `cannot issue a ${currency} document without an FX rate — provide fx_rate or enable the FX source`,
        );
      }
      rate = resolved;
    }
    return {
      currency,
      fx_rate: rate.toFixed(8),
      fx_rate_date: freezeDate,
      amount_cad: convertToCad(total.toString(), rate).toFixed(2),
    };
  }

  /**
   * Fetch the client's confirmed sales for the period, price each item from `client_billing_rates`
   * as of its sale_date, and build the one-line-per-customer draft. Shared by statement + invoice
   * generation so both totals are derived identically (#3-safe). Throws 404 / 422.
   */
  async priceClientPeriod(clientId: string, payPeriodId: string): Promise<PricedContext> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, client_code: true, currency: true },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    const period = await this.prisma.payPeriod.findUnique({
      where: { id: payPeriodId },
      select: { id: true, period_number: true, start_date: true, end_date: true },
    });
    if (!period) {
      throw new NotFoundException('Pay period not found');
    }

    // Confirmed sales only (validated/in_pay_run/paid); sale_date governs the period (#7). Items that
    // were clawed back are excluded (cancelled/reversed → not billed). — decision #4
    const sales = await this.prisma.sale.findMany({
      where: {
        client_id: clientId,
        status: { in: ['validated', 'in_pay_run', 'paid'] },
        sale_date: { gte: period.start_date, lte: period.end_date },
      },
      select: {
        id: true,
        customer_name: true,
        sale_date: true,
        sale_items: {
          where: { item_status: { not: 'clawed_back' } },
          select: { product_id: true, product: { select: { name: true } } },
        },
      },
      orderBy: [{ sale_date: 'asc' }, { sale_code: 'asc' }],
    });

    // All of the client's PRODUCT billing rates (add-on kinds are not applied — deferred, §12),
    // grouped by product so selection is per-scope. This is the ONLY pricing source (#3).
    const rates = await this.prisma.clientBillingRate.findMany({
      where: { client_id: clientId, rate_kind: 'product' },
      select: { id: true, product_id: true, effective_from: true, effective_to: true, amount: true },
    });
    const ratesByProduct = new Map<string, BillingRateRow[]>();
    for (const rate of rates) {
      if (!rate.product_id) continue;
      const bucket = ratesByProduct.get(rate.product_id);
      if (bucket) bucket.push(rate);
      else ratesByProduct.set(rate.product_id, [rate]);
    }

    const unpriced: { product_id: string; product_name: string; sale_date: string }[] = [];
    const saleInputs: SaleInput[] = [];
    for (const sale of sales) {
      if (sale.sale_items.length === 0) continue; // every item clawed back → nothing to bill
      const items = sale.sale_items.map((item) => {
        const scope = ratesByProduct.get(item.product_id) ?? [];
        const rate = selectEffectiveRate(scope, sale.sale_date); // effective on the sale_date (#10)
        if (!rate) {
          unpriced.push({
            product_id: item.product_id,
            product_name: item.product.name,
            sale_date: sale.sale_date.toISOString().slice(0, 10),
          });
        }
        return {
          product_id: item.product_id,
          product_name: item.product.name,
          rate: rate ? toDecimal(rate.amount) : null,
        };
      });
      saleInputs.push({ sale_id: sale.id, customer_name: sale.customer_name, items });
    }

    // Never silently under-bill: a sold product with no effective rate aborts generation. — decision #2
    if (unpriced.length > 0) {
      throw new UnprocessableEntityException({
        message: 'cannot generate: some sold products have no effective client_billing_rate',
        unpriced,
      });
    }

    return { client, period, draft: buildStatement(saleInputs) };
  }

  /**
   * PREVIEW the one-line-per-customer draft WITHOUT persisting (no number is minted). Lets the UI show the
   * combined-total rows before issuing. Same pricing + 422-on-unpriced as generate. — BILL (preview)
   */
  async preview(clientId: string, payPeriodId: string): Promise<{
    client_id: string;
    pay_period_id: string;
    lines: { sale_id: string; customer_name: string; products_summary: string; line_total: string }[];
    total_amount: string;
  }> {
    const { draft } = await this.priceClientPeriod(clientId, payPeriodId);
    return {
      client_id: clientId,
      pay_period_id: payPeriodId,
      lines: draft.lines.map((l) => ({
        sale_id: l.sale_id,
        customer_name: l.customer_name,
        products_summary: l.products_summary,
        line_total: formatMoney(l.line_total),
      })),
      total_amount: formatMoney(draft.total_amount),
    };
  }

  /**
   * ISSUE a statement: mint a gapless number + CREATE a new IMMUTABLE version; the prior current version for
   * the (client, period) is marked `superseded` (metadata only — its number/total/lines are never mutated).
   * A correction is just another generate → a NEW numbered document. Gapless under concurrency: the number
   * is minted inside the SAME transaction (sequence row lock). — BRD §8 (numbering + immutability)
   */
  async generate(clientId: string, payPeriodId: string, actorId: string, fxOverride?: string) {
    const { client, period, draft } = await this.priceClientPeriod(clientId, payPeriodId);

    const lineData = draft.lines.map((l) => ({
      sale_id: l.sale_id,
      customer_name: l.customer_name,
      products_summary: l.products_summary,
      line_total: formatMoney(l.line_total),
    }));

    // Freeze the FX snapshot AT ISSUE (#12) — CAD → rate 1; the total_amount is in the client's currency.
    const fx = await this.resolveIssueFx(client.currency, draft.total_amount, fxOverride);

    const statement = await this.prisma.$transaction(async (tx) => {
      const statement_number = await this.sequence.next(tx, 'statement'); // gapless, row-locked
      const created = await tx.clientStatement.create({
        data: {
          statement_number,
          status: 'issued',
          client_id: clientId,
          pay_period_id: payPeriodId,
          total_amount: formatMoney(draft.total_amount),
          currency: fx.currency,
          fx_rate: fx.fx_rate,
          fx_rate_date: fx.fx_rate_date,
          amount_cad: fx.amount_cad,
          generated_by: actorId,
          lines: { create: lineData },
        },
        include: STATEMENT_INCLUDE,
      });
      // Supersede the prior CURRENT version (if any) — metadata only; the old document is never mutated.
      const prior = await tx.clientStatement.findFirst({
        where: { client_id: clientId, pay_period_id: payPeriodId, status: 'issued', id: { not: created.id } },
        select: { id: true },
      });
      if (prior) {
        await tx.clientStatement.update({
          where: { id: prior.id },
          data: { status: 'superseded', superseded_by_id: created.id },
        });
      }
      return created;
    });

    await this.audit.log({
      actorId,
      entityType: 'client_statements',
      entityId: statement.id,
      action: 'create',
      after: {
        statement_number: statement.statement_number,
        client_id: clientId,
        pay_period_id: payPeriodId,
        total_amount: formatMoney(draft.total_amount),
        line_count: statement.lines.length,
      },
    });
    // Best-effort: notify Admins/Super Admins a statement is available. — statement_ready
    const statementEvent = {
      eventType: 'statement_ready' as const,
      title: 'A statement is ready',
      body: `Statement ${statementNo(statement.statement_number)} for ${client.client_code} period ${period.period_number} is available.`,
      relatedEntityType: 'client_statements',
      relatedEntityId: statement.id,
      variables: { period_number: String(period.period_number) },
    };
    await this.emitter.emitRole('Admin', statementEvent);
    await this.emitter.emitRole('Super Admin', statementEvent);
    return statement;
  }

  list(query: { client_id?: string; pay_period_id?: string }) {
    return this.prisma.clientStatement.findMany({
      where: {
        ...(query.client_id ? { client_id: query.client_id } : {}),
        ...(query.pay_period_id ? { pay_period_id: query.pay_period_id } : {}),
      },
      orderBy: { statement_number: 'desc' }, // newest issued numbers first; every version is shown (audit trail)
    });
  }

  async findOne(id: string) {
    const statement = await this.prisma.clientStatement.findUnique({
      where: { id },
      include: STATEMENT_INCLUDE,
    });
    if (!statement) {
      throw new NotFoundException('Statement not found');
    }
    return statement;
  }
}
