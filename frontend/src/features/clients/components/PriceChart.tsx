/**
 * PriceChart — the at-a-glance rate card: what this client is charged TODAY, and what changes next. The
 * effective-dated table beside it is the AUDIT history; this is the readable summary (review item #19).
 * Every amount is the server's decimal string through `money()` — no arithmetic here (#1). Statuses are
 * server-derived. Billing stream only (#3). Rides the same billing_rates:view gate as the panel.
 */
import { Badge, Banner, Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { buildPriceChart, unpricedRows } from '../priceChart';
import type { BillingRate, Product } from '../clients.types';
import styles from './clients.module.css';

export function PriceChart({
  products,
  rates,
  currency,
}: {
  products: Product[];
  rates: BillingRate[];
  currency: string;
}) {
  const rows = buildPriceChart(products, rates, productTypeLabel);
  const unpriced = unpricedRows(rows);

  if (rows.length === 0) {
    return <p className={styles.supersedeNote}>No products or rates yet — add a product, then price it.</p>;
  }

  return (
    <div className={styles.priceChart}>
      {unpriced.length > 0 && (
        <Banner tone="warning" title="Some products have no rate in force">
          {unpriced.map((r) => r.label).join(', ')} — a statement covering a sale of these will be refused as
          unpriced. Add a rate effective on or before the sale date.
        </Banner>
      )}
      <Table>
        <THead>
          <TR>
            <TH>Product / rate</TH>
            <TH align="right">Today ({currency})</TH>
            <TH>Next change</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.key}>
              <TD>
                <div className={styles.priceLabel}>{row.label}</div>
                <div className={styles.priceDetail}>{row.detail}</div>
              </TD>
              <TD numeric>
                {row.current ? (
                  money(row.current.amount, currency)
                ) : (
                  <Badge tone="warning">Not priced</Badge>
                )}
              </TD>
              <TD>
                {row.pending ? (
                  <span className={styles.priceDetail}>
                    {money(row.pending.amount, currency)} from {displayDate(row.pending.effective_from)}
                  </span>
                ) : (
                  <span className={styles.priceDetail}>—</span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
