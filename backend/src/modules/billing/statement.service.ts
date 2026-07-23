/**
 * StatementService — generates the CLIENT STATEMENT (what Redwave bills the program partner) for a
 * client + BILLING WEEK, and exposes the priced draft for the invoice to reuse.
 *
 * Priced **SOLELY** from `client_billing_rates` (effective-dated by each sale's `sale_date`, #7/#10)
 * via the shared `selectEffectiveRate`. There is **NO** code path here that reads `commission_*`
 * tables or the engine — the two rate streams never mix (#3, the prior system's core defect). The
 * module computes no commission and freezes nothing (read-only over sales × billing rates).
 *
 * One line per SALE (= one customer/household), carrying the amount from EVERY rate kind — internet
 * `product` rate, `tv_addon`, `hp_addon`, `bundle_bonus`, `spiff`, plus any other priced product — so the
 * line reconciles against its own Total. — SRS BILL-001 / docs/uat/billing-target-format.md
 *
 * The period is the **billing week (Mon–Sun)**, not the pay period: a bill straddles two pay periods.
 * Money is exact Decimal, never float (#1). No GST anywhere (BILL-004). Owns client_statements + _lines.
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
import {
  buildStatement,
  PricedItem,
  SaleComponents,
  SaleInput,
  StatementDraft,
  StatementLineDraft,
} from './statement.logic';
import { summariseLines } from './statement-summary.logic';

/** Core catalogue keys the workbook prints as their own columns (is_system, so these keys are stable). */
const TV_KEY = 'tv';
const HOME_PHONE_KEY = 'home_phone';
/** A product type that counts as "Internet" for the presence flag + the Product column. */
const INTERNET_BEHAVIOURS = new Set(['tiered', 'greenfield']);

const ZERO = new Decimal(0);
const dateIso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * A drafted line → the persisted/serialised shape: every money field a canonical 2-dp string (#1). Used for
 * BOTH the `client_statement_lines` write and the preview response, so what you preview is what gets issued.
 */
function lineToMoneyStrings(l: StatementLineDraft) {
  return {
    sort_order: l.sort_order,
    sale_date: l.sale_date,
    rep_code: l.rep_code,
    rep_name: l.rep_name,
    customer_name: l.customer_name,
    customer_first_name: l.customer_first_name,
    customer_last_name: l.customer_last_name,
    address: l.address,
    channel: l.channel,
    product_name: l.product_name,
    products_summary: l.products_summary,
    has_internet: l.has_internet,
    has_tv: l.has_tv,
    has_home_phone: l.has_home_phone,
    internet_rate: formatMoney(l.internet_rate),
    tv_rate: formatMoney(l.tv_rate),
    hp_rate: formatMoney(l.hp_rate),
    bundle_bonus: formatMoney(l.bundle_bonus),
    spiff: formatMoney(l.spiff),
    other_total: formatMoney(l.other_total),
    line_total: formatMoney(l.line_total),
  };
}

/** The FX snapshot frozen onto a billing document AT ISSUE (#12). */
export interface IssueFx {
  currency: string;
  fx_rate: string; // 8-dp decimal string; '1.00000000' for CAD
  fx_rate_date: Date;
  amount_cad: string; // = roundHalfUp(total × fx_rate)
}

/** Prisma.Decimal → decimal.js (billing stream only; never the commission engine's path, #3). */
const toDecimal = (value: Prisma.Decimal): Decimal => new Decimal(value.toString());

/** A bundle's line name from its (sorted) trigger types' catalogue labels — e.g. "Home Phone + TV bundle". */
function bundleLabel(trigger: string[], labels: Map<string, string>): string {
  const parts = trigger.map((k) => labels.get(k) ?? k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  return `${parts.join(' + ')} bundle`;
}

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
  /** The applied spiff's own window, for the "Spiff (…)" column header — null unless exactly one applied. */
  spiffWindow: { from: Date; to: Date | null } | null;
}

const STATEMENT_INCLUDE = { lines: { orderBy: { sort_order: 'asc' } } } as const;

/** A persisted line → the summariser's string shape. Legacy lines carry nulls; they contribute 0, honestly. */
function toSummarisable(l: {
  has_internet: boolean;
  has_tv: boolean;
  has_home_phone: boolean;
  internet_rate: Prisma.Decimal | null;
  tv_rate: Prisma.Decimal | null;
  hp_rate: Prisma.Decimal | null;
  bundle_bonus: Prisma.Decimal | null;
  spiff: Prisma.Decimal | null;
  other_total: Prisma.Decimal | null;
  line_total: Prisma.Decimal;
}) {
  const money = (v: Prisma.Decimal | null): string => (v ? v.toString() : '0');
  return {
    has_internet: l.has_internet,
    has_tv: l.has_tv,
    has_home_phone: l.has_home_phone,
    internet_rate: money(l.internet_rate),
    tv_rate: money(l.tv_rate),
    hp_rate: money(l.hp_rate),
    bundle_bonus: money(l.bundle_bonus),
    spiff: money(l.spiff),
    other_total: money(l.other_total),
    line_total: l.line_total.toString(),
  };
}

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
   * Fetch the client's confirmed sales for the BILLING WEEK, resolve every rate kind from
   * `client_billing_rates` as of each sale's sale_date, and build the one-line-per-customer draft. Shared by
   * statement + invoice generation so both totals are derived identically (#3-safe). Throws 404 / 422.
   */
  async priceClientPeriod(clientId: string, billingPeriodId: string): Promise<PricedContext> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, client_code: true, currency: true },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    const period = await this.prisma.billingPeriod.findUnique({
      where: { id: billingPeriodId },
      select: { id: true, period_number: true, start_date: true, end_date: true },
    });
    if (!period) {
      throw new NotFoundException('Billing period not found');
    }

    // Confirmed sales only (validated/in_pay_run/paid); sale_date governs which bill it lands in (#7). Items
    // that were clawed back are excluded (cancelled/reversed → not billed). — decision #4
    const sales = await this.prisma.sale.findMany({
      where: {
        client_id: clientId,
        status: { in: ['validated', 'in_pay_run', 'paid'] },
        sale_date: { gte: period.start_date, lte: period.end_date },
      },
      select: {
        id: true,
        customer_name: true,
        customer_first_name: true,
        customer_last_name: true,
        street: true,
        city: true,
        province_state: true,
        postal_code: true,
        sale_date: true,
        rep: { select: { rep_code: true, full_name: true } },
        sale_items: {
          where: { item_status: { not: 'clawed_back' } },
          select: { product_id: true, product_type: true, product: { select: { name: true } } },
        },
      },
      orderBy: [{ sale_date: 'asc' }, { sale_code: 'asc' }],
    });

    // Every one of the client's billing rates — ONE read, then split by kind. This is the ONLY pricing
    // source (#3): `product` per product, plus the client-wide add-on / bundle / spiff kinds.
    const allRates = await this.prisma.clientBillingRate.findMany({
      where: { client_id: clientId },
      select: {
        id: true,
        product_id: true,
        rate_kind: true,
        effective_from: true,
        effective_to: true,
        amount: true,
        bundle_product_types: true,
      },
    });

    const ratesByProduct = new Map<string, BillingRateRow[]>();
    for (const rate of allRates) {
      if (rate.rate_kind !== 'product' || !rate.product_id) continue;
      const bucket = ratesByProduct.get(rate.product_id);
      if (bucket) bucket.push(rate);
      else ratesByProduct.set(rate.product_id, [rate]);
    }
    // Client-wide add-on + spiff rates: one effective-dated scope each (no product, no trigger set).
    const kindScope = (kind: string): BillingRateRow[] => allRates.filter((r) => r.rate_kind === kind);
    const tvAddonRates = kindScope('tv_addon');
    const hpAddonRates = kindScope('hp_addon');
    const spiffRates = kindScope('spiff');

    // Which product types are "Internet" (behaviour tiered/greenfield) — read from the catalogue so an
    // SA-added type behaves correctly without a code change.
    const catalogue = await this.prisma.productTypeCatalogue.findMany({
      select: { key: true, label: true, behaviour: true },
    });
    const internetTypes = new Set(catalogue.filter((t) => INTERNET_BEHAVIOURS.has(t.behaviour)).map((t) => t.key));

    // BUNDLES: a `bundle_bonus` applies to a sale's line when the sale contains ALL of its trigger product
    // types (config-driven via bundle_product_types — NOT special-cased). Grouped by trigger set; the
    // effective rate is selected on the sale_date like product rates. Bundles are ADDITIVE (a missing
    // bundle rate is simply not applied — no 422). — SRS BILL-013 / CLAUDE §3 #3 (client-bill only)
    const bundleGroups = new Map<string, { trigger: string[]; rows: BillingRateRow[] }>();
    for (const b of allRates) {
      if (b.rate_kind !== 'bundle_bonus') continue;
      const key = b.bundle_product_types.join(',');
      const group = bundleGroups.get(key);
      if (group) group.rows.push(b);
      else bundleGroups.set(key, { trigger: b.bundle_product_types, rows: [b] });
    }
    const typeLabels = new Map(catalogue.map((t) => [t.key, t.label]));

    const unpriced: { product_id: string; product_name: string; sale_date: string }[] = [];
    const saleInputs: SaleInput[] = [];
    const spiffWindows = new Map<string, { from: Date; to: Date | null }>();

    for (const sale of sales) {
      if (sale.sale_items.length === 0) continue; // every item clawed back → nothing to bill

      const saleTypes = new Set(sale.sale_items.map((i) => i.product_type));
      const has_tv = saleTypes.has(TV_KEY);
      const has_home_phone = saleTypes.has(HOME_PHONE_KEY);
      const has_internet = [...saleTypes].some((t) => internetTypes.has(t));

      // ── Per-product rates. Internet feeds its own column; TV/HP are held aside as the FALLBACK for the
      //    add-on kinds; anything else (Wireless / Protection Plan / Mesh / …) rolls into `other` so a
      //    priced product is never silently dropped from the bill.
      const items: PricedItem[] = [];
      let internet = ZERO;
      let other = ZERO;
      let tvProductRate: Decimal | null = null;
      let hpProductRate: Decimal | null = null;
      let product_name = '';

      for (const item of sale.sale_items) {
        const rate = selectEffectiveRate(ratesByProduct.get(item.product_id) ?? [], sale.sale_date); // #10
        const amount = rate ? toDecimal(rate.amount) : null;
        items.push({ product_id: item.product_id, product_name: item.product.name, rate: amount });

        if (internetTypes.has(item.product_type)) {
          if (!product_name) product_name = item.product.name; // the speed the client is billed for
          if (amount) internet = internet.plus(amount);
        } else if (item.product_type === TV_KEY) {
          if (amount) tvProductRate = (tvProductRate ?? ZERO).plus(amount);
        } else if (item.product_type === HOME_PHONE_KEY) {
          if (amount) hpProductRate = (hpProductRate ?? ZERO).plus(amount);
        } else if (amount) {
          other = other.plus(amount);
        }

        // A product with NO rate from any kind is an under-bill; TV/HP are resolved below, so defer them.
        if (!amount && item.product_type !== TV_KEY && item.product_type !== HOME_PHONE_KEY) {
          unpriced.push({ product_id: item.product_id, product_name: item.product.name, sale_date: dateIso(sale.sale_date) });
        }
      }

      // ── TV / Home Phone: the client-wide ADD-ON kind wins; the product rate is the fallback. Configuring
      //    a tv_addon switches the client over without re-entering products, and the two never stack.
      const tvAddon = has_tv ? selectEffectiveRate(tvAddonRates, sale.sale_date) : null;
      const hpAddon = has_home_phone ? selectEffectiveRate(hpAddonRates, sale.sale_date) : null;
      const tv = tvAddon ? toDecimal(tvAddon.amount) : (tvProductRate ?? ZERO);
      const home_phone = hpAddon ? toDecimal(hpAddon.amount) : (hpProductRate ?? ZERO);

      // A TV/HP product priced by neither its own rate nor an add-on rate is still an under-bill.
      for (const item of sale.sale_items) {
        const unresolvedTv = item.product_type === TV_KEY && !tvAddon && tvProductRate === null;
        const unresolvedHp = item.product_type === HOME_PHONE_KEY && !hpAddon && hpProductRate === null;
        if (unresolvedTv || unresolvedHp) {
          unpriced.push({ product_id: item.product_id, product_name: item.product.name, sale_date: dateIso(sale.sale_date) });
        }
      }

      // ── Bundle: applies when the sale contains ALL of a bundle's trigger types (config-driven, not
      //    special-cased). Additive — a missing bundle rate is simply not applied (no 422).
      let bundle = ZERO;
      for (const { trigger, rows } of bundleGroups.values()) {
        if (!trigger.every((t) => saleTypes.has(t))) continue;
        const bundleRate = selectEffectiveRate(rows, sale.sale_date); // #10
        if (!bundleRate) continue;
        bundle = bundle.plus(toDecimal(bundleRate.amount));
        items.push({ product_id: null, product_name: bundleLabel(trigger, typeLabels), rate: toDecimal(bundleRate.amount) });
      }

      // ── Spiff: a client-wide, date-bounded promotion. Its own effective window is what the workbook's
      //    column header prints, so remember which row applied.
      const spiffRate = selectEffectiveRate(spiffRates, sale.sale_date); // #10
      let spiff = ZERO;
      if (spiffRate) {
        spiff = toDecimal(spiffRate.amount);
        spiffWindows.set(spiffRate.id, { from: spiffRate.effective_from, to: spiffRate.effective_to });
      }

      const components: SaleComponents = { internet, tv, home_phone, bundle, spiff, other };
      saleInputs.push({
        sale_id: sale.id,
        sale_date: dateIso(sale.sale_date),
        rep_code: sale.rep.rep_code,
        rep_name: sale.rep.full_name,
        customer_name: sale.customer_name,
        customer_first_name: sale.customer_first_name,
        customer_last_name: sale.customer_last_name,
        address: [sale.street, sale.city, sale.province_state, sale.postal_code].filter(Boolean).join(', '),
        channel: client.client_code,
        product_name,
        has_internet,
        has_tv,
        has_home_phone,
        components,
        items,
      });
    }

    // Never silently under-bill: a sold product with no effective rate aborts generation. — decision #2
    if (unpriced.length > 0) {
      throw new UnprocessableEntityException({
        message: 'cannot generate: some sold products have no effective client_billing_rate',
        unpriced,
      });
    }

    // Only a SINGLE applied spiff can be labelled honestly in one column header; several distinct windows
    // in one week → no range shown (the renderer falls back to the bill week).
    const spiffWindow = spiffWindows.size === 1 ? [...spiffWindows.values()][0] : null;

    return { client, period, draft: buildStatement(saleInputs), spiffWindow };
  }

  /**
   * PREVIEW the draft WITHOUT persisting (no number is minted). Lets the UI show the exact rows — including
   * every component — before issuing. Same pricing + 422-on-unpriced as generate. — BILL (preview)
   */
  async preview(clientId: string, billingPeriodId: string) {
    const { draft } = await this.priceClientPeriod(clientId, billingPeriodId);
    return {
      client_id: clientId,
      billing_period_id: billingPeriodId,
      lines: draft.lines.map((l) => ({ ...lineToMoneyStrings(l), sale_id: l.sale_id })),
      total_amount: formatMoney(draft.total_amount),
      summary: summariseLines(draft.lines.map(lineToMoneyStrings)),
    };
  }

  /**
   * ISSUE a statement: mint a gapless number + CREATE a new IMMUTABLE version; the prior current version for
   * the (client, period) is marked `superseded` (metadata only — its number/total/lines are never mutated).
   * A correction is just another generate → a NEW numbered document. Gapless under concurrency: the number
   * is minted inside the SAME transaction (sequence row lock). — BRD §8 (numbering + immutability)
   */
  async generate(clientId: string, billingPeriodId: string, actorId: string, fxOverride?: string) {
    const { client, period, draft, spiffWindow } = await this.priceClientPeriod(clientId, billingPeriodId);

    const lineData = draft.lines.map((l) => ({ ...lineToMoneyStrings(l), sale_id: l.sale_id }));

    // Freeze the FX snapshot AT ISSUE (#12) — CAD → rate 1; the total_amount is in the client's currency.
    const fx = await this.resolveIssueFx(client.currency, draft.total_amount, fxOverride);

    const statement = await this.prisma.$transaction(async (tx) => {
      const statement_number = await this.sequence.next(tx, 'statement'); // gapless, row-locked
      const created = await tx.clientStatement.create({
        data: {
          statement_number,
          status: 'issued',
          client_id: clientId,
          billing_period_id: billingPeriodId,
          spiff_from: spiffWindow?.from ?? null,
          spiff_to: spiffWindow?.to ?? null,
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
        where: { client_id: clientId, billing_period_id: billingPeriodId, status: 'issued', id: { not: created.id } },
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
        billing_period_id: billingPeriodId,
        total_amount: formatMoney(draft.total_amount),
        line_count: statement.lines.length,
      },
    });
    // Best-effort: notify Admins/Super Admins a statement is available. — statement_ready
    const statementEvent = {
      eventType: 'statement_ready' as const,
      title: 'A statement is ready',
      body: `Statement ${statementNo(statement.statement_number)} for ${client.client_code} bill ${period.period_number} is available.`,
      relatedEntityType: 'client_statements',
      relatedEntityId: statement.id,
      variables: { period_number: String(period.period_number) },
    };
    await this.emitter.emitRole('Admin', statementEvent);
    await this.emitter.emitRole('Super Admin', statementEvent);
    return statement;
  }

  list(query: { client_id?: string; billing_period_id?: string }) {
    return this.prisma.clientStatement.findMany({
      where: {
        ...(query.client_id ? { client_id: query.client_id } : {}),
        ...(query.billing_period_id ? { billing_period_id: query.billing_period_id } : {}),
      },
      orderBy: { statement_number: 'desc' }, // newest issued numbers first; every version is shown (audit trail)
    });
  }

  /** The statement + its lines in render order + the summary strip (summed from the FROZEN lines, never re-priced). */
  async findOne(id: string) {
    const statement = await this.prisma.clientStatement.findUnique({
      where: { id },
      include: STATEMENT_INCLUDE,
    });
    if (!statement) {
      throw new NotFoundException('Statement not found');
    }
    return { ...statement, summary: summariseLines(statement.lines.map(toSummarisable)) };
  }

  /** The weekly billing calendar (Mon–Sun, "Bill 17") the UI picks from. Read-only + seeded, like pay periods. */
  listPeriods() {
    return this.prisma.billingPeriod.findMany({ orderBy: { period_number: 'asc' } });
  }
}
