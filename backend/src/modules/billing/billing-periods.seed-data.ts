/**
 * Pure generator for the 2026 weekly BILLING schedule — the client-billing week.
 *
 * Weeks run **Monday→Sunday** and are numbered sequentially ("Bill 17"). This is deliberately NOT the pay
 * period: pay periods run Sunday→Saturday biweekly, so a bill straddles two of them and billing needs its
 * own calendar. There is no payday here — a bill is what the client owes, not what a rep is paid.
 *
 * Pure & deterministic (used by the seed and unit-tested). — docs/uat/billing-target-format.md
 */
export interface SeedBillingPeriod {
  period_number: number;
  start_date: string; // 'YYYY-MM-DD' (Monday)
  end_date: string; // 'YYYY-MM-DD' (Sunday)
}

const ANCHOR = '2026-01-05'; // first Monday of 2026
const WEEK_DAYS = 7;

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function generate2026BillingPeriods(count = 52): SeedBillingPeriod[] {
  const periods: SeedBillingPeriod[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = addDays(ANCHOR, i * WEEK_DAYS);
    periods.push({
      period_number: i + 1,
      start_date: start,
      end_date: addDays(start, WEEK_DAYS - 1),
    });
  }
  return periods;
}
