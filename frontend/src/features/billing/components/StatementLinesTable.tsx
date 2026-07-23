/**
 * StatementLinesTable — the statement exactly as the client sees it: ONE ROW PER SALE with the amount from
 * each rate kind, then the row Total. Every figure is the server's frozen decimal string via money() — the UI
 * prices nothing and sums nothing (#1); the totals live in the summary strip above, also server-computed.
 * There is **NO GST** line/field anywhere. The "Other" column appears only when a row carries one, mirroring
 * the exported workbook. Wide by design, so the table scrolls inside its own pane. Tokens only.
 * — docs/uat/billing-target-format.md
 */
import { Check, Minus } from 'lucide-react';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import styles from './billing.module.css';
import type { ClientStatementLine } from '../billing.types';

/** A presence flag — a check or a dash, never a bare "true"/"false". */
function Flag({ on }: { on: boolean }) {
  return on ? (
    <Check size={15} aria-label="Yes" className={styles.flagOn} />
  ) : (
    <Minus size={15} aria-label="No" className={styles.flagOff} />
  );
}

/** A money cell; a null component (a legacy line) reads as an em dash rather than a misleading 0.00. */
const amount = (v: string | null, currency: string) => (v === null ? '—' : money(v, currency));

export function StatementLinesTable({ lines, currency = 'CAD' }: { lines: ClientStatementLine[]; currency?: string }) {
  const showOther = lines.some((l) => l.other_total !== null && Number(l.other_total) !== 0);

  return (
    <Table maxHeight="60vh">
      <THead>
        <TR>
          <TH>Sale date</TH>
          <TH>Agent</TH>
          <TH>Customer</TH>
          <TH>Address</TH>
          <TH>Channel</TH>
          <TH>Product</TH>
          <TH align="center">Internet</TH>
          <TH align="center">TV</TH>
          <TH align="center">Home phone</TH>
          <TH align="right">Internet</TH>
          <TH align="right">TV</TH>
          <TH align="right">HP</TH>
          <TH align="right">Bundle</TH>
          <TH align="right">Spiff</TH>
          {showOther && <TH align="right">Other</TH>}
          <TH align="right">Total</TH>
        </TR>
      </THead>
      <TBody>
        {lines.map((l) => (
          <TR key={l.id}>
            <TD><span className="mono">{l.sale_date ? displayDate(l.sale_date) : '—'}</span></TD>
            <TD>
              <div>{l.rep_name ?? '—'}</div>
              <div className={styles.subtle}>{l.rep_code ?? ''}</div>
            </TD>
            <TD>
              {l.customer_first_name || l.customer_last_name
                ? `${l.customer_first_name ?? ''} ${l.customer_last_name ?? ''}`.trim()
                : l.customer_name}
            </TD>
            <TD><span className={styles.subtle}>{l.address ?? '—'}</span></TD>
            <TD>{l.channel ?? '—'}</TD>
            <TD>{l.product_name ?? l.products_summary}</TD>
            <TD align="center"><Flag on={l.has_internet} /></TD>
            <TD align="center"><Flag on={l.has_tv} /></TD>
            <TD align="center"><Flag on={l.has_home_phone} /></TD>
            <TD numeric>{amount(l.internet_rate, currency)}</TD>
            <TD numeric>{amount(l.tv_rate, currency)}</TD>
            <TD numeric>{amount(l.hp_rate, currency)}</TD>
            <TD numeric>{amount(l.bundle_bonus, currency)}</TD>
            <TD numeric>{amount(l.spiff, currency)}</TD>
            {showOther && <TD numeric>{amount(l.other_total, currency)}</TD>}
            <TD numeric>{money(l.line_total, currency)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
