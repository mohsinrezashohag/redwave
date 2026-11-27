/**
 * DuplicateBadge — "Possible duplicate of <Sale ID>" for a sale entered with the same MPU, address or customer
 * name as a live sale for that client (2026-11-28), linking to the original, and says what matched. Held
 * sales don't count until approved; once approved the badge says so in a muted tone. Renders nothing for a sale that is not flagged. — client meeting 2026-11-16
 */
import { Link } from 'react-router-dom';
import { Badge } from '../../../components/ui';
import type { Sale } from '../sales.types';
import { duplicateReasonText } from '../saleGates';
import styles from './DuplicateBadge.module.css';

type Flagged = Pick<Sale, 'duplicate_of_sale_id' | 'duplicate_of_sale_code' | 'duplicate_approved_at'> &
  Partial<Pick<Sale, 'duplicate_reason'>>;

export function DuplicateBadge({ sale }: { sale: Flagged }) {
  if (!sale.duplicate_of_sale_id) return null;
  const code = sale.duplicate_of_sale_code ?? 'another sale';
  const approved = !!sale.duplicate_approved_at;
  return (
    <Badge tone={approved ? 'muted' : 'warning'}>
      {approved ? 'Duplicate approved: ' : 'Possible duplicate of '}
      <Link to={`/sales/${sale.duplicate_of_sale_id}`} className={styles.link} onClick={(e) => e.stopPropagation()}>
        <span className="mono">{code}</span>
      </Link>
      {!approved && sale.duplicate_reason ? ` (${duplicateReasonText(sale.duplicate_reason).replace(/^the same /, 'same ')})` : null}
    </Badge>
  );
}
