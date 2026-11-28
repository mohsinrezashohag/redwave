/**
 * Row classification — PURE & deterministic (no I/O). Given a row's mapped data plus the context the
 * service pre-fetched from the DB, decide the row's `match_status` + an operator-facing `issue`. All
 * DB lookups (matching sales, rep/period existence, existing ledger) happen in the service and are
 * passed in as primitives, keeping this fully unit-testable. — SRS §15 (IMP-003/004/005/007)
 */
import { MatchStatus } from '@prisma/client';
import { RawRow } from './mapping.logic';
import { invalidFields, isTrue } from './clean.logic';
import { clientNotFoundIssue, invalidIssue, missingIssue, quote, repNotFoundIssue, rowIssue } from './issue-format.logic';
import { resolveVocabValue, splitValues, Vocab } from './value-vocabulary.logic';

export interface Classification {
  match_status: MatchStatus;
  issue: string | null;
  matched_entity_id?: string;
}

const MONEY = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = (row: RawRow, key: string): string | null => {
  const v = row[key];
  return v === undefined || v === null || v === '' ? null : String(v);
};

const matched = (id?: string): Classification => ({
  match_status: 'matched',
  issue: null,
  ...(id ? { matched_entity_id: id } : {}),
});
const error = (issue: string): Classification => ({ match_status: 'error', issue });

const productTypeNotFound = (type: string): string =>
  rowIssue('product_type', `${quote(type)} is not in the product-type catalogue`, 'Add it under Commission config, or fix the spelling');

const noProductIssue = (types: string[], clientCode: string | null): string =>
  rowIssue(
    'product_types',
    `client ${clientCode} has no active ${types.join(', ')} product`,
    'Add the product under Clients (or import products first), then re-check',
  );

/**
 * A blank REQUIRED field says "is required"; a non-blank value that could not be parsed says "is not a
 * valid …" (cleaning remembers it, see `invalidFields`). A blank OPTIONAL field is never an issue.
 * — client meeting 2026-11-16
 */
export function dateIssue(mapped: RawRow, field: string, required: boolean): string | null {
  const value = str(mapped, field);
  if (invalidFields(mapped)[field] !== undefined || (value && !DATE.test(value))) {
    return invalidIssue(field, 'date', invalidFields(mapped)[field] ?? value);
  }
  return !value && required ? missingIssue(field, '2026-11-24') : null;
}

export function moneyIssue(mapped: RawRow, field: string, required: boolean): string | null {
  const value = str(mapped, field);
  if (invalidFields(mapped)[field] !== undefined || (value && !MONEY.test(value))) {
    return invalidIssue(field, 'money', invalidFields(mapped)[field] ?? value);
  }
  return !value && required ? missingIssue(field, '89.99') : null;
}

/** Marker the reconcile step writes into a live-sale row an approver accepted as a possible duplicate. */
export const ACCEPT_DUPLICATE_KEY = 'accept_duplicate';
export const ACCEPTED_DUPLICATE_ISSUE =
  'Accepted as a possible duplicate. The sale will be held until its duplicate is approved, then it can be validated.';

// ── client_report + sales (bulk validation; SALE-007 / IMP-010) ──────────────────────────────────
/** `matchedSaleIds` = the `entered` sales the service found for this row's MPU + client. */
export function classifySalesRow(
  mapped: RawRow,
  ctx: { matchedSaleIds: string[] },
): Classification {
  const mpuId = str(mapped, 'mpu_id');
  if (ctx.matchedSaleIds.length === 1) {
    return matched(ctx.matchedSaleIds[0]);
  }
  if (ctx.matchedSaleIds.length > 1) {
    return { match_status: 'duplicate', issue: rowIssue('mpu_id', `more than one open sale has MPU ${mpuId}`, 'Match this row to the right sale by hand') };
  }
  return {
    match_status: 'unmatched',
    issue: mpuId
      ? rowIssue('mpu_id', `no open sale has MPU ${mpuId}`, 'Check the MPU ID, or match the row to a sale by hand')
      : rowIssue('mpu_id', 'missing, so the row cannot be matched automatically', 'Match it to a sale by hand'),
  };
}

// ── master_migration + billing_rates (back-dated billing rates; #10) ─────────────────────────────
/** Shape + existence (existence flags pre-fetched by the service from the friendly client_code/product_name). */
export function classifyBillingRateRow(
  mapped: RawRow,
  ctx: { clientExists: boolean; productExists: boolean },
): Classification {
  const client_code = str(mapped, 'client_code');
  const rate_kind = str(mapped, 'rate_kind');
  const product_name = str(mapped, 'product_name');

  if (!client_code) return error(missingIssue('client_code', 'VF'));
  if (!rate_kind) return error(missingIssue('rate_kind', 'product'));
  if (rate_kind === 'product' && !product_name) return error(rowIssue('product_name', 'missing, and a "product" rate needs one', 'Fill in the product name'));
  if (moneyIssue(mapped, 'amount', true)) return error(moneyIssue(mapped, 'amount', true)!);
  if (dateIssue(mapped, 'effective_from', true)) return error(dateIssue(mapped, 'effective_from', true)!);
  if (dateIssue(mapped, 'effective_to', false)) return error(dateIssue(mapped, 'effective_to', false)!);
  if (!ctx.clientExists) return error(clientNotFoundIssue(client_code));
  if (rate_kind === 'product' && !ctx.productExists) return error(rowIssue('product_name', `${quote(product_name)} was not found for client ${client_code}`, 'Add it under Clients, or fix the name'));
  return matched();
}

// ── master_migration + km_rates / commission_flat_rates ──────────────────────
// The REP-stream counterparts of the billing-rate migration path above. The live services reject a past
// `effective_from` (422) to protect closed periods; these targets are the audited way to load history
// (#10). Everything below is shape + existence only — the WRITE is the handler's job.
// — docs/claude-code/04-backdate-import.md

/** Both km streams. `rep` is what a rep is reimbursed; `client_bill` is what the client is charged (#3). */
const KM_STREAMS = new Set(['rep', 'client_bill']);
/** rate_per_km is Decimal(6,3) — up to 3 dp, unlike money's 2. */
const RATE_PER_KM = /^\d+(\.\d{1,3})?$/;

/** `client_code` is OPTIONAL on all three: blank = the GLOBAL row every client falls back to. */
export function classifyKmRateRow(mapped: RawRow, ctx: { clientExists: boolean }): Classification {
  const client_code = str(mapped, 'client_code');
  const stream = str(mapped, 'stream');
  const rate_per_km = str(mapped, 'rate_per_km');

  if (!stream) return error(missingIssue('stream', 'rep or client_bill'));
  if (!KM_STREAMS.has(stream)) return error(rowIssue('stream', `${quote(stream)} is not valid`, 'Use rep or client_bill'));
  if (!rate_per_km) return error(missingIssue('rate_per_km', '0.450'));
  if (!RATE_PER_KM.test(rate_per_km)) return error(rowIssue('rate_per_km', `${quote(rate_per_km)} is not a valid rate`, 'Use a number with up to 3 decimals, for example 0.450'));
  if (dateIssue(mapped, 'effective_from', true)) return error(dateIssue(mapped, 'effective_from', true)!);
  if (dateIssue(mapped, 'effective_to', false)) return error(dateIssue(mapped, 'effective_to', false)!);
  if (client_code && !ctx.clientExists) return error(clientNotFoundIssue(client_code));
  return matched();
}

/** `product_type` must already be in the SA-governed catalogue — an import never invents one (§14 rule 7). */
export function classifyCommissionFlatRateRow(
  mapped: RawRow,
  ctx: { clientExists: boolean; productTypeExists: boolean },
): Classification {
  const client_code = str(mapped, 'client_code');
  const product_type = str(mapped, 'product_type');

  if (!product_type) return error(missingIssue('product_type', 'internet'));
  if (moneyIssue(mapped, 'amount', true)) return error(moneyIssue(mapped, 'amount', true)!);
  if (dateIssue(mapped, 'effective_from', true)) return error(dateIssue(mapped, 'effective_from', true)!);
  if (dateIssue(mapped, 'effective_to', false)) return error(dateIssue(mapped, 'effective_to', false)!);
  if (!ctx.productTypeExists) return error(productTypeNotFound(product_type));
  if (client_code && !ctx.clientExists) return error(clientNotFoundIssue(client_code));
  return matched();
}

// ── master_migration + clients (create/upsert clients) ───────────────────────────────────────────
export function classifyClientRow(mapped: RawRow, ctx: { existingClientId: string | null }): Classification {
  const client_code = str(mapped, 'client_code');
  const name = str(mapped, 'name');
  const market = (str(mapped, 'market') ?? '').toUpperCase();
  if (!client_code) return error(missingIssue('client_code', 'VF'));
  if (!name) return error(missingIssue('name', 'Valley Fiber'));
  if (market !== 'CA' && market !== 'US') return error(market ? rowIssue('market', `${quote(market)} is not valid`, 'Use CA or US') : missingIssue('market', 'CA'));
  return matched(ctx.existingClientId ?? undefined); // existing → update; else create
}

// ── master_migration + products (create products + optional inline rate) ─────────────────────────
export function classifyProductRow(
  mapped: RawRow,
  ctx: { clientExists: boolean; productTypeExists: boolean },
): Classification {
  const client_code = str(mapped, 'client_code');
  const name = str(mapped, 'name');
  const product_type = str(mapped, 'product_type');
  const billing_amount = str(mapped, 'billing_amount');
  const effective_from = str(mapped, 'effective_from');
  if (!client_code) return error(missingIssue('client_code', 'VF'));
  if (!name) return error(missingIssue('name', 'Fibre 1gig/2.5gig'));
  if (!product_type) return error(missingIssue('product_type', 'internet'));
  if (!ctx.clientExists) return error(clientNotFoundIssue(client_code));
  if (!ctx.productTypeExists) return error(productTypeNotFound(product_type));
  if (moneyIssue(mapped, 'billing_amount', false)) return error(moneyIssue(mapped, 'billing_amount', false)!);
  if (billing_amount) {
    if (!effective_from || !DATE.test(effective_from)) return error(rowIssue('effective_from', 'missing, and a billing amount needs one', 'Use YYYY-MM-DD, for example 2026-11-24'));
  }
  return matched();
}

// ── master_migration + reps (create reps; rep_code never reused, #11) ────────────────────────────
export function classifyRepRow(mapped: RawRow, ctx: { codeExists: boolean }): Classification {
  const rep_code = str(mapped, 'rep_code');
  const full_name = str(mapped, 'full_name');
  if (!rep_code) return error(missingIssue('rep_code', 'RW012'));
  if (!full_name) return error(missingIssue('full_name', 'Jane Doe'));
  if (dateIssue(mapped, 'hire_date', true)) return error(dateIssue(mapped, 'hire_date', true)!);
  if (ctx.codeExists) return error(rowIssue('rep_code', `${quote(rep_code)} already exists, and rep codes are never reused`, 'Give this rep a new code'));
  return matched();
}

// ── master_migration + sales (HISTORICAL — reference-only; never paid) ───────────────────────────
/**
 * ONE ROW = ONE HOUSEHOLD, so `product_types` may list several ("Internet, TV, Home Phone") and the row
 * becomes one sale with N items. The service resolves the raw cell through the value vocabulary first, so a
 * human-written `"Internet, TV"` arrives here as `['internet','tv']`.
 *
 * Unlike the LIVE target this does NOT require an internet base (SALE-001a is an entry rule; history is
 * reference data and may legitimately record a TV-only household).
 */
export function classifyHistoricalSaleRow(
  mapped: RawRow,
  ctx: {
    clientExists: boolean;
    repExists: boolean;
    /** Types the vocabulary could not resolve at all (verbatim, for the message). */
    unknownProductTypes: string[];
    /** Resolved types that have NO active product for this client. */
    missingProductTypes: string[];
    /** Count of types that DID resolve — zero means the cell named nothing usable. */
    resolvedCount: number;
    /** The canonical form of what resolved, for a "did you mean …" hint. */
    suggestion: string | null;
    /**
     * The operator opted in to creating referenced master data that doesn't exist yet. A missing
     * client/rep/product then becomes a MATCHED row carrying a note about what will be created, instead of
     * an error. Never set for live sales — see the guard in `ImportService.analyze`.
     */
    createMissing?: boolean;
  },
): Classification {
  const client_code = str(mapped, 'client_code');
  const rep_code = str(mapped, 'rep_code');
  const product_types = str(mapped, 'product_types');
  if (!client_code) return error(missingIssue('client_code', 'VF'));
  if (!rep_code) return error(missingIssue('rep_code', 'RW012'));
  if (!product_types) return error(missingIssue('product_types', 'internet,tv'));
  if (dateIssue(mapped, 'sale_date', true)) return error(dateIssue(mapped, 'sale_date', true)!);
  if (moneyIssue(mapped, 'billed_amount', true)) return error(moneyIssue(mapped, 'billed_amount', true)!);

  // An unresolvable TYPE is always an error, even with create-missing on: the product-type catalogue is
  // Super-Admin-governed configuration (#10), not something an uploaded file may extend.
  if (ctx.unknownProductTypes.length > 0) return error(unknownTypeIssue(ctx.unknownProductTypes, ctx.suggestion));
  if (ctx.resolvedCount === 0) return error(rowIssue('product_types', `${quote(product_types)} names no known product type`, 'Use internet, tv or home_phone'));

  const willCreate: string[] = [];
  if (!ctx.clientExists) {
    if (!ctx.createMissing) return error(clientNotFoundIssue(client_code));
    willCreate.push(`client ${client_code}`);
  }
  if (!ctx.repExists) {
    if (!ctx.createMissing) return error(repNotFoundIssue(rep_code));
    willCreate.push(`rep ${rep_code}`);
  }
  if (ctx.missingProductTypes.length > 0) {
    if (!ctx.createMissing) {
      return error(noProductIssue(ctx.missingProductTypes, client_code));
    }
    willCreate.push(`${ctx.missingProductTypes.join(', ')} product${ctx.missingProductTypes.length > 1 ? 's' : ''}`);
  }

  // Matched, but the operator should see what this row is about to bring into existence.
  return willCreate.length > 0 ? { match_status: 'matched', issue: `Will create ${willCreate.join(', ')} when you commit.` } : matched();
}

/**
 * The operator-facing message for an unresolvable type. It names the FIX: the old message claimed the
 * product was missing when the product existed and only the spelling differed, which sent operators off to
 * re-import their product master for no reason.
 */
export function unknownTypeIssue(unknown: string[], suggestion: string | null): string {
  const listed = unknown.map((u) => `"${u}"`).join(', ');
  const verb = unknown.length > 1 ? 'are not known product types' : 'is not a known product type';
  return rowIssue('product_types', `${listed} ${verb}`, suggestion ? `Did you mean ${suggestion}?` : 'Check the spelling against the product-type catalogue');
}

// ── sales_entry + sales (LIVE sale entry; IMP-013) ───────────────────────────────────────────────
/**
 * Split a `product_types` cell into canonical catalogue keys. The naive comma-split this replaced only
 * handled `internet,tv` written exactly as the system stores it; resolution now goes through the value
 * vocabulary, so `"Internet, TV"` / `"Internet + TV"` / `"HP"` and SA-added types all land correctly.
 *
 * `vocab` is optional so the pure unit tests (and any caller without catalogue rows to hand) keep the old
 * lenient behaviour: with no vocabulary the fragments are simply normalised, never invented.
 */
export const splitProductTypes = (value: string | null, vocab?: Vocab): string[] => {
  if (vocab && vocab.length > 0) {
    return resolveVocabValue(value, vocab).keys;
  }
  return splitValues(value).map((t) => t.trim().toLowerCase());
};

const LIVE_SALE_STATUSES = ['entered', 'validated'];

/**
 * A LIVE sale row. Unlike the historical target these become real sales that reach the engine, so every
 * reference must already exist — an unresolvable client / rep / product is an ERROR, never an implicit
 * create. The mandatory internet base (SALE-001a) is checked HERE so a bad row surfaces as `error` and the
 * reconcile gate blocks the commit, instead of throwing mid-transaction and rolling the whole batch back.
 */
export function classifyLiveSaleRow(
  mapped: RawRow,
  ctx: {
    clientExists: boolean;
    /** The rep exists AND is active (SalesService rejects an inactive rep). */
    repActive: boolean;
    /** Types the vocabulary could not resolve at all (verbatim, for the message). */
    unknownProductTypes?: string[];
    /** The canonical form of what resolved, for a "did you mean …" hint. */
    suggestion?: string | null;
    /** Listed types that have NO active product for this client. */
    missingProductTypes: string[];
    /** True when at least one listed type has catalogue behaviour `internet` or `greenfield`. */
    hasInternetBase: boolean;
    /**
     * The sale this row would duplicate: an existing live sale with the same client + MPU (its sale code),
     * or `'this file'` for an earlier row of the same batch. MPU is the partner's per-house id, so one
     * client + MPU is one household (§14 rule 8). null/absent = not a duplicate.
     */
    duplicateOf?: string | null;
  },
): Classification {
  const client_code = str(mapped, 'client_code');
  const rep_code = str(mapped, 'rep_code');
  const rawTypes = str(mapped, 'product_types');
  // A blank customer cell is fine when the first + last name columns carry it: SalesService derives the
  // display name from the pair. — 2026-11-16
  const customer_name =
    str(mapped, 'customer_name') ??
    ([str(mapped, 'customer_first_name'), str(mapped, 'customer_last_name')].filter(Boolean).join(' ') || null);
  const status = (str(mapped, 'status') ?? 'entered').toLowerCase();

  if (!client_code) return error(missingIssue('client_code', 'VF'));
  if (!rep_code) return error(missingIssue('rep_code', 'Redwave23'));
  if (!rawTypes) return error(rowIssue('product_types', 'missing', 'Fill in product types (for example internet,tv), or mark the Internet / TV / Home Phone columns TRUE'));
  if (dateIssue(mapped, 'sale_date', true)) return error(dateIssue(mapped, 'sale_date', true)!);
  if (!customer_name) return error(rowIssue('customer_name', 'missing', 'Fill in the customer name, or the first and last name'));
  if (!LIVE_SALE_STATUSES.includes(status)) {
    return error(rowIssue('status', `${quote(status)} is not valid`, 'Use entered or validated, or leave it blank'));
  }
  const unknownTypes = ctx.unknownProductTypes ?? [];
  if (unknownTypes.length > 0) return error(unknownTypeIssue(unknownTypes, ctx.suggestion ?? null));
  if (!ctx.clientExists) return error(clientNotFoundIssue(client_code));
  if (!ctx.repActive) return error(repNotFoundIssue(rep_code));
  const acceptedDuplicate = !!ctx.duplicateOf && isTrue(mapped[ACCEPT_DUPLICATE_KEY]);
  if (ctx.duplicateOf && !acceptedDuplicate) {
    const mpu = str(mapped, 'mpu_id');
    return {
      match_status: 'duplicate',
      issue:
        ctx.duplicateOf === 'this file'
          ? rowIssue('mpu_id', `${mpu} appears more than once in this file`, 'Ignore the extra row, or accept it as a duplicate')
          : rowIssue('mpu_id', `${mpu} is already entered for client ${client_code} as sale ${ctx.duplicateOf}`, 'Ignore this row, or accept it as a duplicate'),
    };
  }
  if (ctx.missingProductTypes.length > 0) {
    return error(noProductIssue(ctx.missingProductTypes, client_code));
  }
  // SALE-001a — internet is the mandatory base; add-ons cannot be sold standalone.
  if (!ctx.hasInternetBase) {
    return error(
      rowIssue(
        'product_types',
        'no internet on this sale, and every sale needs internet (TV, Home Phone or a drop permit cannot be imported on their own)',
        'Ignore this row, or add the internet product',
      ),
    );
  }
  // An approver accepted this possible duplicate at reconcile: it commits FLAGGED (SalesService sets
  // duplicate_of_sale_id) and stays held until approved. — 2026-11-16
  return acceptedDuplicate ? { match_status: 'matched', issue: ACCEPTED_DUPLICATE_ISSUE } : matched();
}
