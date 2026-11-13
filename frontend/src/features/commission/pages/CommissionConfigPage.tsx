/**
 * CommissionConfigPage — the REP-commission config (SRS §7), SEPARATE from Clients (#3): the rep rates (one
 * flat rate per item, by product type or product, global or per client) and incentives, each in the shared
 * EffectiveDatedTable (#10). No tiers and no 70/30 since 2026-11-13: Redwave applies those manually, outside
 * the system, from its exports. `commission:view` to
 * see; edit actions gated `commission:edit`; the server enforces (§5). 403 → AccessDenied.
 */
import { useState } from 'react';
import { Card, PageHeader } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { FlatRatesSection } from '../components/FlatRatesSection';
import { IncentivesSection } from '../components/IncentivesSection';
import { ScopeSelector } from '../components/ScopeSelector';
import { SCOPE_ALL, type ScopeValue } from '../clientScope';
import styles from '../components/commission.module.css';

export default function CommissionConfigPage() {
  const canView = useCan('commission:view');
  // Client scope for the rate list.
  const [scope, setScope] = useState<ScopeValue>(SCOPE_ALL);
  if (!canView) {
    return <AccessDenied message="Viewing commission config requires the commission view permission." />;
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Commission Configuration"
        subtitle="What reps are paid per item, and incentives. Every change is dated and applies from its start date onward."
      />
      <Card title="Rate scope">
        <ScopeSelector value={scope} onChange={setScope} />
      </Card>
      <FlatRatesSection scope={scope} />
      <IncentivesSection />
    </div>
  );
}
