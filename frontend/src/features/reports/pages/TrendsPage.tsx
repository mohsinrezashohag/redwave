/**
 * TrendsPage — /reports/trends: the cross-period trend charts as a first-class report (the hub card's
 * target). REUSES the Batch-4 `BusinessTrends` component + endpoint verbatim (the same charts render at
 * the bottom of the Business dashboard) with a periods depth selector (the endpoint caps at 24). Gated
 * like the Business dashboard: `reports:business` — the useCan check is convenience, the server is the
 * real gate (§5; the endpoint is @RequirePermission('reports','business')).
 */
import { useState } from 'react';
import { PageHeader, Select } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { BusinessTrends } from '../../dashboards/components/BusinessTrends';
import styles from './reports.module.css';

const DEPTHS = [
  { value: '6', label: 'Last 6 periods' },
  { value: '12', label: 'Last 12 periods' },
  { value: '24', label: 'Last 24 periods' },
];

export default function TrendsPage() {
  const canBusiness = useCan('reports:business');
  const [depth, setDepth] = useState('6');

  if (!canBusiness) {
    return <AccessDenied message="Cross-period trends ride the business dashboard permission (reports:business)." />;
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Cross-period trends"
        subtitle="Revenue, payout, and activation trends over recent pay periods. Money is read from frozen records — nothing is recomputed."
        actions={<Select aria-label="Periods" options={DEPTHS} value={depth} onValueChange={setDepth} />}
      />
      <BusinessTrends periods={Number(depth)} />
    </div>
  );
}
