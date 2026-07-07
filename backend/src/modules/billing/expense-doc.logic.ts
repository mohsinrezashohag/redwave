/**
 * Client EXPENSE billing document aggregation — PURE & deterministic (no I/O, no Prisma, no dates, no FX).
 *
 * Builds the grouped line detail for the per-client expense document (BILL-012 / EXP-014): km + food only,
 * grouped by expense **type**, itemized **per rep per day**. Each input row is ALREADY priced in the client's
 * currency by the service (km = billable_km × the CLIENT-BILL rate; food = the item amount, native currency)
 * — this module only GROUPS and SUMS. One line per (type × rep × day); amounts within a cell are summed.
 *
 * ZERO awareness of the commission stream (#3 — the streams never mix) and of receipts (EXP-003). Money is
 * exact decimal (decimal.js), never float (CLAUDE §3 #1). The FX freeze to CAD happens in the service, once,
 * at issue (#12) — never here.
 */
import { Decimal } from 'decimal.js';

export type ExpenseDocType = 'km' | 'meals';

/** One priced, per-item input (the service resolves km rate + currency BEFORE calling this). */
export interface ExpenseDocRow {
  type: ExpenseDocType;
  rep_id: string;
  rep_name: string;
  date: string; // 'YYYY-MM-DD'
  description: string;
  amount: Decimal; // in the client's currency
}

/** One aggregated statement-style line = one (type × rep × day) cell. */
export interface ExpenseDocLine {
  type: ExpenseDocType;
  rep_id: string;
  rep_name: string;
  date: string;
  description: string;
  amount: Decimal;
}

export interface ExpenseDocDraft {
  lines: ExpenseDocLine[];
  total_amount: Decimal;
}

// km lines sort before meals lines (the document sections the two types).
const TYPE_ORDER: Record<ExpenseDocType, number> = { km: 0, meals: 1 };

/**
 * Group priced rows into one line per (type × rep × day), summing amounts in each cell, and total across all.
 * Lines are sorted type → rep_name → date so the rendered document is stable/deterministic. — SRS EXP-014
 */
export function buildExpenseDoc(rows: ExpenseDocRow[]): ExpenseDocDraft {
  const groups = new Map<string, ExpenseDocLine>();
  for (const row of rows) {
    const key = `${row.type}|${row.rep_id}|${row.date}`;
    const existing = groups.get(key);
    if (existing) {
      existing.amount = existing.amount.plus(row.amount);
      // Accumulate distinct descriptions for the itemized-per-day cell.
      if (row.description && !existing.description.split('; ').includes(row.description)) {
        existing.description = existing.description ? `${existing.description}; ${row.description}` : row.description;
      }
    } else {
      groups.set(key, { ...row, amount: new Decimal(row.amount) });
    }
  }

  const lines = [...groups.values()].sort(
    (a, b) =>
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      a.rep_name.localeCompare(b.rep_name) ||
      a.date.localeCompare(b.date),
  );
  const total_amount = lines.reduce((sum, line) => sum.plus(line.amount), new Decimal(0));
  return { lines, total_amount };
}
