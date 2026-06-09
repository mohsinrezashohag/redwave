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
import { buildStatement, SaleInput, StatementDraft } from './statement.logic';

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
  client: { id: string; client_code: string };
  period: { id: string; period_number: number };
  draft: StatementDraft;
}

const STATEMENT_INCLUDE = { lines: true } as const;

@Injectable()
export class StatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
  ) {}

  /**
   * Fetch the client's confirmed sales for the period, price each item from `client_billing_rates`
   * as of its sale_date, and build the one-line-per-customer draft. Shared by statement + invoice
   * generation so both totals are derived identically (#3-safe). Throws 404 / 422.
   */
  async priceClientPeriod(clientId: string, payPeriodId: string): Promise<PricedContext> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, client_code: true },
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

  async generate(clientId: string, payPeriodId: string, actorId: string) {
    const { client, period, draft } = await this.priceClientPeriod(clientId, payPeriodId);
    const fileUrl = `s3://redwave-exports/statements/${client.client_code}-P${period.period_number}.xlsx`;

    const lineData = draft.lines.map((l) => ({
      sale_id: l.sale_id,
      customer_name: l.customer_name,
      products_summary: l.products_summary,
      line_total: l.line_total.toFixed(2),
    }));

    // Replace-in-place per (client, period) — no @@unique, so regeneration is enforced here in a
    // transaction (delete lines + update header + recreate), never a silent duplicate.
    const statement = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.clientStatement.findFirst({
        where: { client_id: clientId, pay_period_id: payPeriodId },
        select: { id: true },
      });
      if (existing) {
        await tx.clientStatementLine.deleteMany({ where: { statement_id: existing.id } });
        return tx.clientStatement.update({
          where: { id: existing.id },
          data: {
            total_amount: draft.total_amount.toFixed(2),
            generated_by: actorId,
            generated_at: new Date(),
            file_url: fileUrl,
            lines: { create: lineData },
          },
          include: STATEMENT_INCLUDE,
        });
      }
      return tx.clientStatement.create({
        data: {
          client_id: clientId,
          pay_period_id: payPeriodId,
          total_amount: draft.total_amount.toFixed(2),
          file_url: fileUrl,
          generated_by: actorId,
          lines: { create: lineData },
        },
        include: STATEMENT_INCLUDE,
      });
    });

    await this.audit.log({
      actorId,
      entityType: 'client_statements',
      entityId: statement.id,
      action: 'create',
      after: {
        client_id: clientId,
        pay_period_id: payPeriodId,
        total_amount: draft.total_amount.toFixed(2),
        line_count: statement.lines.length,
      },
    });
    // Best-effort: notify Admins/Super Admins a statement is available. — statement_ready
    const statementEvent = {
      eventType: 'statement_ready' as const,
      title: 'A statement is ready',
      body: `The statement for ${client.client_code} period ${period.period_number} is available.`,
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
      orderBy: { generated_at: 'desc' },
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
