/**
 * ExpenseDocLinesTable — renders the grouped km + food lines (one per rep/day), sectioned by type. The rows
 * come from the server's frozen line_detail (or a preview); the UI prices nothing (#1) — money() display only.
 * Amounts are in the document's currency (#12). No receipts (EXP-003).
 */
import { Fragment } from 'react';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import type { ExpenseDocLine } from '../expenseDocs.types';

const SECTION_LABEL: Record<'km' | 'meals', string> = { km: 'Kilometres', meals: 'Food' };

export function ExpenseDocLinesTable({ lines, currency }: { lines: ExpenseDocLine[]; currency: string }) {
  // Lines arrive pre-sorted (km → meals → rep → date). Insert a section header row when the type changes.
  let lastType: 'km' | 'meals' | null = null;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Date</TH>
          <TH>Rep</TH>
          <TH>Detail</TH>
          <TH align="right">Amount</TH>
        </TR>
      </THead>
      <TBody>
        {lines.map((l, i) => {
          const showHeader = l.type !== lastType;
          lastType = l.type;
          return (
            <Fragment key={`${l.type}-${l.rep_id}-${l.date}-${i}`}>
              {showHeader && (
                <TR>
                  <TD colSpan={4}>
                    <strong>{SECTION_LABEL[l.type]}</strong>
                  </TD>
                </TR>
              )}
              <TR>
                <TD><span className="mono">{l.date}</span></TD>
                <TD>{l.rep_name}</TD>
                <TD>{l.description}</TD>
                <TD numeric>{money(l.amount, currency)}</TD>
              </TR>
            </Fragment>
          );
        })}
      </TBody>
    </Table>
  );
}
