/**
 * PaidItemsPanel — the selected sale's items, classified for clawback. A CLAWABLE item is paid + frozen
 * (`commission_paid != null`) and not already clawed (`item_status != 'clawed_back'`); only those get a
 * "Claw back" action. Non-clawable items render greyed with the reason. The frozen rate/incentive are shown
 * read-only (the snapshot is never edited — #2). No money is computed here. Tokens only.
 */
import { Button } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import { productTypeLabel } from '../../../lib/format/productType';
import { isClawable } from '../clawback.logic';
import styles from './clawback.module.css';
import type { Sale, SaleItem } from '../../sales/sales.types';

function reasonNotClawable(item: SaleItem): string {
  if (item.item_status === 'clawed_back') return 'Already clawed back';
  if (item.commission_paid === null) return 'Not paid yet. Only paid items can be clawed back.';
  return '';
}

export function PaidItemsPanel({ sale, onClawback }: { sale: Sale; onClawback: (item: SaleItem) => void }) {
  return (
    <div>
      <h3 className={styles.sectionTitle}>Items on {sale.sale_code}</h3>
      <p className={styles.note}>A clawback targets one item. It does not affect the internet activation or recalculate the period’s tier.</p>
      <div className={styles.items}>
        {sale.sale_items.map((item) => {
          const clawable = isClawable(item);
          return (
            <div key={item.id} className={clawable ? styles.itemRow : `${styles.itemRow} ${styles.itemRowDisabled}`}>
              <div className={styles.itemMeta}>
                <span className={styles.itemProduct}>{productTypeLabel(item.product_type)}</span>
                <span className={styles.itemSnapshot}>
                  <span>
                    Rate <strong>{money(item.rate_applied)}</strong>
                  </span>
                  <span>
                    Incentive <strong>{money(item.incentive_amount)}</strong>
                  </span>
                  {item.tier_at_payment !== null && (
                    <span>
                      Tier <strong>{item.tier_at_payment}</strong>
                    </span>
                  )}
                </span>
              </div>
              {clawable ? (
                <Button variant="secondary" size="sm" onClick={() => onClawback(item)}>
                  Claw back
                </Button>
              ) : (
                <span className={styles.note}>{reasonNotClawable(item)}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
