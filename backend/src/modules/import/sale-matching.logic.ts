/**
 * Client-report → entered-sale matching — PURE & deterministic (no I/O).
 *
 * MPU ID is the partner's own per-house identifier (SRS glossary). CTI and Valley Fiber print it on their
 * remittance files; **RF Now does not**, and neither do Redwave's own working spreadsheets. Bulk validation
 * used to match on MPU and nothing else, so a file without one produced "no MPU ID — manual match required"
 * on EVERY row and the reconcile gate refused the commit — the whole feature was unusable for those clients.
 * IMP-004 says match on MPU "where available"; this is the where-it-isn't path.
 *
 * The rule that matters: **a fuzzy match never auto-validates a sale.** Validating the wrong sale pays the
 * wrong rep, so only an UNAMBIGUOUS single strong candidate is auto-matched. Anything else is handed back
 * with its candidates for the operator to confirm — SALE-007's "surfacing only mismatches for manual
 * matching", now with the candidates already found.
 */
import { normalizeToken, squashToken } from './normalize';

export interface CandidateSale {
  id: string;
  sale_code: string;
  customer_name: string | null;
  street: string | null;
  sale_date: string;
  activation_date: string | null;
}

export interface ReportRow {
  customer_name: string | null;
  service_address: string | null;
  activation_date: string | null;
}

export interface ScoredCandidate {
  sale: CandidateSale;
  score: number;
  /** Why it scored — shown to the operator so a suggestion is never a black box. */
  reasons: string[];
}

/** A name AND address agreement. Below this nothing is ever auto-matched. */
export const STRONG_MATCH = 100;

/**
 * Address lines drift constantly between a partner's file and what a rep typed ("23 Shoreline Dr" vs
 * "23 Shoreline Drive"), so compare the leading house number plus the squashed first word of the street —
 * the part that is actually stable.
 */
function addressKey(address: string | null): string | null {
  const norm = normalizeToken(address ?? '');
  if (norm === '') return null;
  const [number, ...rest] = norm.split(' ');
  if (!/^\d+$/.test(number) || rest.length === 0) return squashToken(norm).slice(0, 12) || null;
  return `${number}|${rest[0]}`;
}

/** Surname + first initial — tolerates "Mark Thibault" vs "M. Thibault" without matching unrelated people. */
function nameKey(name: string | null): string | null {
  const norm = normalizeToken(name ?? '');
  if (norm === '') return null;
  const parts = norm.split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${last}|${parts[0][0]}`;
}

/** Score one candidate against one report row. 0 means "no relationship" and is never offered. */
export function scoreCandidate(row: ReportRow, sale: CandidateSale): ScoredCandidate {
  const reasons: string[] = [];
  let score = 0;

  const rowName = nameKey(row.customer_name);
  const saleName = nameKey(sale.customer_name);
  const exactName = normalizeToken(row.customer_name ?? '') !== '' && normalizeToken(row.customer_name ?? '') === normalizeToken(sale.customer_name ?? '');
  if (exactName) {
    score += 60;
    reasons.push('customer name');
  } else if (rowName !== null && rowName === saleName) {
    // Surname + first initial. Weighted so that WITH an address agreement it still reaches STRONG_MATCH:
    // the same surname at the same house number is decisive in practice, and the real risk here — a
    // spouse on a second sale at that address — is caught by the ambiguity guard below, not by scoring.
    score += 55;
    reasons.push('customer name (approx)');
  }

  const rowAddress = addressKey(row.service_address);
  const saleAddress = addressKey(sale.street);
  if (rowAddress !== null && rowAddress === saleAddress) {
    score += 45;
    reasons.push('address');
  }

  // A date agreement corroborates but never carries a match on its own — many sales share a date.
  if (row.activation_date && (row.activation_date === sale.activation_date || row.activation_date === sale.sale_date)) {
    score += 10;
    reasons.push('date');
  }

  return { sale, score, reasons };
}

export interface MatchOutcome {
  /** Set only when exactly one candidate is strong and nothing else comes close. */
  matchedSaleId?: string;
  /** Best candidates, strongest first — for the operator to confirm. */
  candidates: ScoredCandidate[];
  /** Operator-facing explanation. */
  issue: string | null;
}

/**
 * Decide a row. Auto-matches ONLY when exactly one candidate reaches `STRONG_MATCH` and no runner-up is
 * within 20 points of it — a near-tie means two households look alike, which is precisely when guessing
 * would validate the wrong sale.
 */
export function matchReportRow(row: ReportRow, sales: CandidateSale[]): MatchOutcome {
  const scored = sales
    .map((sale) => scoreCandidate(row, sale))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.sale.sale_code.localeCompare(b.sale.sale_code));

  if (scored.length === 0) {
    return { candidates: [], issue: 'no entered sale matches this customer — match manually' };
  }

  const [best, runnerUp] = scored;
  const decisive = best.score >= STRONG_MATCH && (!runnerUp || best.score - runnerUp.score >= 20);
  if (decisive) {
    return { matchedSaleId: best.sale.id, candidates: scored.slice(0, 3), issue: null };
  }

  const top = scored.slice(0, 3);
  const listed = top.map((c) => `${c.sale.sale_code} (${c.reasons.join(' + ') || 'weak'})`).join('; ');
  return {
    candidates: top,
    issue:
      best.score >= STRONG_MATCH
        ? `several sales match equally well — confirm one: ${listed}`
        : `no confident match — closest: ${listed}`,
  };
}
