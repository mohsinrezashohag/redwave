/**
 * UnpricedBanner — the helpful 422 surface. The backend refuses to generate (never silently under-bill) when
 * a sold product has no effective client_billing_rate; it returns each {product_name, sale_date}. We list
 * them and point the user to Clients & Products to add the rate (the effective-dating screen). Tokens only.
 */
import { Link } from 'react-router-dom';
import { Banner } from '../../../components/ui';
import { displayDate } from '../../../lib/format/date';
import styles from './billing.module.css';
import type { UnpricedDetail } from '../billing.types';

export function UnpricedBanner({ unpriced, clientId }: { unpriced: UnpricedDetail[]; clientId?: string }) {
  return (
    <Banner tone="danger" title="Can’t generate: some products have no billing rate">
      Add an effective client billing rate for each product below in{' '}
      {clientId ? <Link to={`/admin/clients/${clientId}`}>Clients &amp; Products</Link> : 'Clients & Products'}, then regenerate.
      <ul className={styles.unpricedList}>
        {unpriced.map((u, i) => (
          <li key={`${u.product_id}-${i}`}>
            <code>{u.product_name}</code>: no rate effective on <code>{displayDate(u.sale_date)}</code>
          </li>
        ))}
      </ul>
    </Banner>
  );
}
