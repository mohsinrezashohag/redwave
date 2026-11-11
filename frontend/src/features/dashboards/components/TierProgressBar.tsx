/**
 * TierProgressBar — the rep's tier standing (read-only). Shows "Tier N" + a progress bar toward the next
 * bracket and "M to next tier". Driven ONLY by the count→bracket numbers the backend returns
 * (tier_number / count / next_tier_min / to_next) — NO rates are read or shown (#5; rates never leak to
 * the rep view). Tokens only.
 */
import type { RepTier } from '../dashboards.types';
import styles from './TierProgressBar.module.css';

export function TierProgressBar({ tier }: { tier: RepTier | null }) {
  if (!tier) {
    return <p className={styles.empty}>No tier yet. Activations this period will set it.</p>;
  }

  const atTop = tier.to_next === null || tier.next_tier_min === null;
  const pct = atTop || !tier.next_tier_min ? 100 : Math.min(100, Math.round((tier.count / tier.next_tier_min) * 100));

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.tier}>Tier {tier.tier_number}</span>
        <span className={styles.count}>
          <span className="mono">{tier.count}</span> internet activations
        </span>
      </div>
      <div className={styles.track} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
      <p className={styles.caption}>
        {atTop ? (
          'Top tier reached.'
        ) : (
          <>
            <span className="mono">{tier.to_next}</span> to next tier (at{' '}
            <span className="mono">{tier.next_tier_min}</span>)
          </>
        )}
      </p>
    </div>
  );
}
