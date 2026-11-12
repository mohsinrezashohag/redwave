/**
 * CommissionConfigPage — the REP-commission config (SRS §7), SEPARATE from Clients (#3). A stacked page of
 * sections, each reusing the shared EffectiveDatedTable (#10): tier schedule (contiguity-validated bracket
 * editor; storage only, #5), flat rates (internet excluded) and incentives. No holdback split or release
 * rule since 2026-11-13: commission is paid in full. `commission:view` to
 * see; edit actions gated `commission:edit`; the server enforces (§5). 403 → AccessDenied.
 */
import { useState } from 'react';
import { Card, PageHeader } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { TierSchedulesSection } from '../components/TierSchedulesSection';
import { FlatRatesSection } from '../components/FlatRatesSection';
import { TierRatesSection } from '../components/TierRatesSection';
import { IncentivesSection } from '../components/IncentivesSection';
import { ScopeSelector } from '../components/ScopeSelector';
import { SCOPE_ALL, type ScopeValue } from '../clientScope';
import styles from '../components/commission.module.css';

export default function CommissionConfigPage() {
  const canView = useCan('commission:view');
  // Client scope for the RATE sections (tiers + flat rates).
  const [scope, setScope] = useState<ScopeValue>(SCOPE_ALL);
  if (!canView) {
    return <AccessDenied message="Viewing commission config requires the commission view permission." />;
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Commission Configuration"
        subtitle="What reps are paid: tiers, flat rates and incentives. Every change is dated and applies from its start date onward."
      />
      <Card title="Rate scope">
        <ScopeSelector value={scope} onChange={setScope} />
      </Card>
      <TierSchedulesSection scope={scope} />
      <TierRatesSection scope={scope} />
      <FlatRatesSection scope={scope} />
      <IncentivesSection />
    </div>
  );
}
