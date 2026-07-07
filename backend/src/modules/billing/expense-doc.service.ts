/**
 * ClientExpenseDocService — generates the per-client EXPENSE billing document (BILL-012 / EXP-014): km + food
 * only, grouped by expense type, itemized per rep per day, in the client's currency, gapless-numbered (CEXP-)
 * and immutable like statements.
 *
 * SEPARATE stream from commission (#3): reads ONLY `expense_items` + `km_rate_config(client_bill)` — NEVER a
 * commission_* table or the engine. km is RE-PRICED from `km_log.billable_km × the CLIENT-BILL rate` (the
 * stored `amount`/`computed_amount` are REP-priced — never reused). Food (meals) is billed NATIVE-currency:
 * an item is included only if `original_currency == client.currency` (else surfaced in `excluded[]`, never
 * converted). Personal items are excluded (EXP-012); receipts are never referenced (EXP-003).
 *
 * FX freezes ONCE at ISSUE (#12) via the shared `StatementService.resolveIssueFx` (pure FX, no commission).
 * Money is exact Decimal, never float (#1). Owns client_expense_documents.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { KmRateStream, Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { formatMoney, roundMoneyHalfUp } from '../../common/money/money';
import { SequenceService } from '../../common/sequence/sequence.service';
import { KmRateRow, selectKmRate } from '../expenses/km-rate.logic';
import { buildExpenseDoc, ExpenseDocDraft, ExpenseDocRow } from './expense-doc.logic';
import { StatementService } from './statement.service';

/** Which reps / days to include (dynamic selection, EXP-014). Empty = everything in scope. */
export interface ExpenseDocSelection {
  rep_ids?: string[];
  dates?: string[]; // 'YYYY-MM-DD'
}

/** A food item left off because its entry currency ≠ the client's billing currency (native-currency rule). */
export interface ExcludedExpenseItem {
  item_id: string;
  category: string;
  reason: string;
}

interface PricedExpenseContext {
  client: { id: string; client_code: string; currency: string };
  period: { id: string; period_number: number };
  draft: ExpenseDocDraft;
  excluded: ExcludedExpenseItem[];
  selection: ExpenseDocSelection;
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

const EXPENSE_DOC_INCLUDE = { client: { select: { client_code: true } } } as const;

@Injectable()
export class ClientExpenseDocService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
    private readonly statements: StatementService, // reused ONLY for resolveIssueFx (pure FX, #3-safe)
  ) {}

  /**
   * Gather the client's approved, non-personal km + food items for the period (narrowed by the rep/day
   * selection), re-price km at the CLIENT-BILL rate (422 if a km item has none), drop food whose currency
   * ≠ the client's (→ `excluded`), and build the grouped draft. Shared by preview + generate. Throws 404/422.
   */
  async priceExpenseDoc(
    clientId: string,
    payPeriodId: string,
    selection: ExpenseDocSelection = {},
  ): Promise<PricedExpenseContext> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, client_code: true, currency: true },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    const period = await this.prisma.payPeriod.findUnique({
      where: { id: payPeriodId },
      select: { id: true, period_number: true },
    });
    if (!period) {
      throw new NotFoundException('Pay period not found');
    }

    // Approved, NON-personal (EXP-012) km + food items for this client in the period; rep-narrowed in-query.
    const items = await this.prisma.expenseItem.findMany({
      where: {
        client_id: clientId,
        pay_period_id: payPeriodId,
        status: 'approved',
        is_personal: false,
        category: { in: ['km', 'meals'] },
        ...(selection.rep_ids && selection.rep_ids.length > 0 ? { rep_id: { in: selection.rep_ids } } : {}),
      },
      select: {
        id: true,
        category: true,
        expense_date: true,
        amount: true,
        original_currency: true,
        description: true,
        rep_id: true,
        rep: { select: { full_name: true } },
        km_log: { select: { billable_km: true } },
      },
      orderBy: [{ expense_date: 'asc' }],
    });

    // Day-narrow in memory (dates arrive as 'YYYY-MM-DD'; expense_date is a UTC-midnight Date).
    const dateSet = selection.dates && selection.dates.length > 0 ? new Set(selection.dates) : null;
    const inScope = dateSet ? items.filter((i) => dateSet.has(isoDate(i.expense_date))) : items;

    // CLIENT-BILL km rates only (never the rep stream, #3): client-specific first, then global.
    const kmRateRows = await this.prisma.kmRateConfig.findMany({
      where: { stream: KmRateStream.client_bill, OR: [{ client_id: null }, { client_id: clientId }] },
      select: { id: true, client_id: true, rate_per_km: true, effective_from: true, effective_to: true },
    });
    const asRows: KmRateRow[] = kmRateRows.map((r) => ({ ...r, rate_per_km: r.rate_per_km.toString() }));

    const rows: ExpenseDocRow[] = [];
    const excluded: ExcludedExpenseItem[] = [];
    const missingKmRate: { item_id: string; expense_date: string }[] = [];

    for (const item of inScope) {
      const date = isoDate(item.expense_date);
      const rep_id = item.rep_id ?? 'unassigned';
      const rep_name = item.rep?.full_name ?? 'Unassigned';

      if (item.category === 'km') {
        // Re-price at the client-bill rate — NEVER the stored rep amount (#3). Required (no default, 422).
        const rateStr = selectKmRate(asRows, clientId, item.expense_date);
        if (rateStr === null) {
          missingKmRate.push({ item_id: item.id, expense_date: date });
          continue;
        }
        const billable = new Decimal((item.km_log?.billable_km ?? 0).toString());
        const amount = roundMoneyHalfUp(billable.times(new Decimal(rateStr)));
        rows.push({ type: 'km', rep_id, rep_name, date, description: `${billable.toFixed(2)} km`, amount });
      } else {
        // meals — NATIVE currency: bill only items already in the client's currency (never convert).
        if (item.original_currency !== client.currency) {
          excluded.push({ item_id: item.id, category: 'meals', reason: 'currency_mismatch' });
          continue;
        }
        rows.push({
          type: 'meals',
          rep_id,
          rep_name,
          date,
          description: item.description || 'Meals',
          amount: new Decimal(item.amount.toString()),
        });
      }
    }

    // km MUST be priceable at the client-bill rate — never fall back to the CAD-flavoured default (422). — decision
    if (missingKmRate.length > 0) {
      throw new UnprocessableEntityException({
        message: 'cannot generate: some km items have no client-bill km rate for their date — configure one first',
        missing_km_rate: missingKmRate,
      });
    }

    return { client, period, draft: buildExpenseDoc(rows), excluded, selection };
  }

  /** PREVIEW the grouped draft WITHOUT persisting (no number minted, no FX frozen). Same 404/422 as generate. */
  async preview(clientId: string, payPeriodId: string, selection: ExpenseDocSelection = {}) {
    const { draft, excluded } = await this.priceExpenseDoc(clientId, payPeriodId, selection);
    return {
      client_id: clientId,
      pay_period_id: payPeriodId,
      lines: draft.lines.map((l) => ({
        type: l.type,
        rep_id: l.rep_id,
        rep_name: l.rep_name,
        date: l.date,
        description: l.description,
        amount: formatMoney(l.amount),
      })),
      total_amount: formatMoney(draft.total_amount),
      excluded,
    };
  }

  /**
   * ISSUE the expense document: mint a gapless CEXP number + CREATE a new IMMUTABLE version; the prior current
   * version for the (client, period) is marked `superseded` (metadata only). FX is frozen AT ISSUE (#12). The
   * grouped line detail is frozen into `line_detail` so a re-render is stable even if expenses change later.
   */
  async generate(
    clientId: string,
    payPeriodId: string,
    actorId: string,
    selection: ExpenseDocSelection = {},
    fxOverride?: string,
  ) {
    const { client, draft, selection: usedSelection } = await this.priceExpenseDoc(clientId, payPeriodId, selection);

    // Frozen grouped snapshot (money as strings) — the renderer reads THIS, never a live re-query.
    const lineDetail = draft.lines.map((l) => ({
      type: l.type,
      rep_id: l.rep_id,
      rep_name: l.rep_name,
      date: l.date,
      description: l.description,
      amount: formatMoney(l.amount),
    }));

    // Freeze the FX snapshot AT ISSUE (#12) — CAD → rate 1; total_amount is in the client's currency.
    const fx = await this.statements.resolveIssueFx(client.currency, draft.total_amount, fxOverride);

    const doc = await this.prisma.$transaction(async (tx) => {
      const document_number = await this.sequence.next(tx, 'client_expense'); // gapless, row-locked
      const created = await tx.clientExpenseDocument.create({
        data: {
          document_number,
          status: 'issued',
          client_id: clientId,
          pay_period_id: payPeriodId,
          selection_filters: usedSelection as unknown as Prisma.InputJsonValue,
          line_detail: lineDetail as unknown as Prisma.InputJsonValue,
          total_amount: formatMoney(draft.total_amount),
          currency: fx.currency,
          fx_rate: fx.fx_rate,
          fx_rate_date: fx.fx_rate_date,
          amount_cad: fx.amount_cad,
          generated_by: actorId,
        },
        include: EXPENSE_DOC_INCLUDE,
      });
      // Supersede the prior CURRENT version (if any) — metadata only; the old document is never mutated.
      const prior = await tx.clientExpenseDocument.findFirst({
        where: { client_id: clientId, pay_period_id: payPeriodId, status: 'issued', id: { not: created.id } },
        select: { id: true },
      });
      if (prior) {
        await tx.clientExpenseDocument.update({
          where: { id: prior.id },
          data: { status: 'superseded', superseded_by_id: created.id },
        });
      }
      return created;
    });

    await this.audit.log({
      actorId,
      entityType: 'client_expense_documents',
      entityId: doc.id,
      action: 'create',
      after: {
        document_number: doc.document_number,
        client_id: clientId,
        pay_period_id: payPeriodId,
        total_amount: formatMoney(draft.total_amount),
        line_count: lineDetail.length,
      },
    });
    return doc;
  }

  list(query: { client_id?: string; pay_period_id?: string }) {
    return this.prisma.clientExpenseDocument.findMany({
      where: {
        ...(query.client_id ? { client_id: query.client_id } : {}),
        ...(query.pay_period_id ? { pay_period_id: query.pay_period_id } : {}),
      },
      orderBy: { document_number: 'desc' }, // newest issued numbers first; every version shown (audit trail)
    });
  }

  async findOne(id: string) {
    const doc = await this.prisma.clientExpenseDocument.findUnique({ where: { id }, include: EXPENSE_DOC_INCLUDE });
    if (!doc) {
      throw new NotFoundException('Expense document not found');
    }
    return doc;
  }
}
