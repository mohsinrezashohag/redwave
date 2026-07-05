/**
 * InvoiceService — generates the one-line COMMISSION INVOICE for a client + pay period. — SRS BILL-003
 *
 * `total_commission` = the client-billing statement total (Redwave's commission FROM the partner),
 * obtained by reusing `StatementService.priceClientPeriod` — the SAME billing-stream calc as the
 * statement. It NEVER reads rep `commission_*` tables or the engine (#3). One row, no lines, no GST.
 * Replace-in-place per (client, period). Owns client_invoices.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { formatMoney } from '../../common/money/money';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StatementService } from './statement.service';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
    private readonly statements: StatementService,
  ) {}

  /**
   * ISSUE a commission invoice — a NEW gapless-numbered IMMUTABLE version; the prior current version is
   * marked `superseded` (metadata only). `total_commission` = the billing-stream statement total (#3).
   */
  async generate(clientId: string, payPeriodId: string, actorId: string, fxOverride?: string) {
    // Same billing-stream total as the statement (structurally identical — never re-derived). (#3)
    const { client, draft } = await this.statements.priceClientPeriod(clientId, payPeriodId);
    const total = formatMoney(draft.total_amount);
    // Freeze the FX snapshot AT ISSUE (#12) — CAD → rate 1; total_commission is in the client's currency.
    const fx = await this.statements.resolveIssueFx(client.currency, draft.total_amount, fxOverride);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const invoice_number = await this.sequence.next(tx, 'invoice'); // gapless, row-locked
      const created = await tx.clientInvoice.create({
        data: {
          invoice_number,
          status: 'issued',
          client_id: clientId,
          pay_period_id: payPeriodId,
          total_commission: total,
          currency: fx.currency,
          fx_rate: fx.fx_rate,
          fx_rate_date: fx.fx_rate_date,
          amount_cad: fx.amount_cad,
          generated_by: actorId,
        },
      });
      const prior = await tx.clientInvoice.findFirst({
        where: { client_id: clientId, pay_period_id: payPeriodId, status: 'issued', id: { not: created.id } },
        select: { id: true },
      });
      if (prior) {
        await tx.clientInvoice.update({
          where: { id: prior.id },
          data: { status: 'superseded', superseded_by_id: created.id },
        });
      }
      return created;
    });

    await this.audit.log({
      actorId,
      entityType: 'client_invoices',
      entityId: invoice.id,
      action: 'create',
      after: { invoice_number: invoice.invoice_number, client_id: clientId, pay_period_id: payPeriodId, total_commission: total },
    });
    return invoice;
  }

  list(query: { client_id?: string; pay_period_id?: string }) {
    return this.prisma.clientInvoice.findMany({
      where: {
        ...(query.client_id ? { client_id: query.client_id } : {}),
        ...(query.pay_period_id ? { pay_period_id: query.pay_period_id } : {}),
      },
      orderBy: { invoice_number: 'desc' },
    });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.clientInvoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }
}
