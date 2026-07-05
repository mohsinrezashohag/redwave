/**
 * PaidSaleFinder — find a sale that has a clawable item. The Sales API has no text search, so the finder
 * loads the full clawable set (paid + partially-clawed) server-side and filters CLIENT-side by Sale ID,
 * customer, ADDRESS, or REP name (CLAW-009). Rep + Address columns disambiguate same-address reps. The
 * "clawable items" column is a COUNT (not money). Selecting a row reveals its items panel. Tokens only.
 */
import { Input, Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { displayDate } from '../../../lib/format/date';
import { isClawable } from '../clawback.logic';
import styles from './clawback.module.css';
import type { Sale } from '../../sales/sales.types';

interface Props {
  text: string;
  onText: (v: string) => void;
  rows: Sale[];
  /** rep_id → display label (name · code). Absent → a short id (no hrm:view). */
  repLabelById: (repId: string) => string;
  selectedSaleId: string | null;
  onSelect: (saleId: string) => void;
}

const address = (s: Sale): string => [s.street, s.city].filter(Boolean).join(', ');

export function PaidSaleFinder({ text, onText, rows, repLabelById, selectedSaleId, onSelect }: Props) {
  return (
    <div className={styles.page}>
      <div className={styles.controls}>
        <div className={styles.control}>
          <Input
            value={text}
            onChange={(e) => onText(e.target.value)}
            placeholder="Search by Sale ID, customer, address, or rep"
            aria-label="Search paid sales"
          />
        </div>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Sale ID</TH>
            <TH>Customer</TH>
            <TH>Address</TH>
            <TH>Rep</TH>
            <TH>Sale date</TH>
            <TH align="right">Clawable items</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((sale) => (
            <TR key={sale.id} selected={sale.id === selectedSaleId}>
              <TD>
                <button type="button" className={styles.linkBtn} onClick={() => onSelect(sale.id)}>
                  <span className="mono">{sale.sale_code}</span>
                </button>
              </TD>
              <TD>{sale.customer_name}</TD>
              <TD>{address(sale)}</TD>
              <TD>{repLabelById(sale.rep_id)}</TD>
              <TD>
                <span className="mono">{displayDate(sale.sale_date)}</span>
              </TD>
              <TD numeric>{sale.sale_items.filter(isClawable).length}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
