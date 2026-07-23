/**
 * StatementSummaryStrip — the counts + column totals that sit ABOVE the lines, mirroring the summary row of
 * the workbook Redwave sends the client. Every figure is SERVER-computed from the frozen lines
 * (`statement-summary.logic`), so this component adds nothing up (#1). Tokens only.
 * — docs/uat/billing-target-format.md
 */
import { StatCard } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import styles from './billing.module.css';
import type { StatementSummary } from '../billing.types';

export function StatementSummaryStrip({ summary, currency = 'CAD' }: { summary: StatementSummary; currency?: string }) {
  // Zero-valued components are hidden — a client with no spiff should not see an empty Spiff tile.
  const money_tiles = [
    { label: `Internet (${currency})`, value: summary.internet_total },
    { label: `TV (${currency})`, value: summary.tv_total },
    { label: `Home phone (${currency})`, value: summary.hp_total },
    { label: `Bundle (${currency})`, value: summary.bundle_total },
    { label: `Spiff (${currency})`, value: summary.spiff_total },
    { label: `Other (${currency})`, value: summary.other_total },
  ].filter((t) => Number(t.value) !== 0);

  return (
    <div className={styles.summaryStrip}>
      <StatCard label="Sales" value={String(summary.line_count)} />
      <StatCard label="Internet" value={String(summary.internet_count)} />
      <StatCard label="TV" value={String(summary.tv_count)} />
      <StatCard label="Home phone" value={String(summary.home_phone_count)} />
      {money_tiles.map((t) => (
        <StatCard key={t.label} label={t.label} value={money(t.value, currency)} />
      ))}
      <StatCard label={`Total (${currency})`} value={money(summary.grand_total, currency)} />
    </div>
  );
}
