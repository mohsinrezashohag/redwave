/**
 * MissingKmRateBanner — the helpful 422 surface for a km item with no CLIENT-BILL rate.
 *
 * The refusal is correct: the server will not invent a price, and it deliberately will NOT fall back to the
 * rep reimbursement rate — that is the two-stream rule (#3). So this is a CONFIG act, and the only useful
 * thing the UI can do is say which dates are unpriced and take the admin straight to the screen that fixes
 * it. Mirrors the billing UnpricedBanner. Tokens only. — SRS EXP-014 / BILL-012
 */
import { Link } from 'react-router-dom';
import { Banner } from '../../../components/ui';
import { displayDate } from '../../../lib/format/date';
import styles from './expenseDocs.module.css';

export interface MissingKmRate {
  item_id: string;
  expense_date: string;
}

export function MissingKmRateBanner({ missing }: { missing: MissingKmRate[] }) {
  // One row per DATE — the admin adds a rate covering a date, not one per item.
  const dates = [...new Set(missing.map((m) => m.expense_date))].sort();
  return (
    <Banner tone="danger" title="Can’t generate — kilometres have no client-bill rate">
      Add a <strong>client-bill</strong> km rate covering the date(s) below in{' '}
      <Link to="/admin/km-rates">KM rates</Link>, then generate again. The rep reimbursement rate is
      deliberately not used here — what a client is charged and what a rep is paid are separate.
      <ul className={styles.missingList}>
        {dates.map((d) => (
          <li key={d}>
            <code>{displayDate(d)}</code> — no client-bill rate in effect
          </li>
        ))}
      </ul>
    </Banner>
  );
}
