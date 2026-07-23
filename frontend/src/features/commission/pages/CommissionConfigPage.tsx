/**
 * CommissionConfigPage — the REP-commission config (SRS §7), SEPARATE from Clients (#3). A stacked page of
 * sections, each reusing the shared EffectiveDatedTable (#10): tier schedule (contiguity-validated bracket
 * editor; storage only, #5), flat rates (internet excluded), holdback split (100% check), the PROPOSED
 * holdback-release setting, and incentives (per_activation; target_based deferred). `commission:view` to
 * see; edit actions gated `commission:edit`; the server enforces (§5). 403 → AccessDenied.
 */
import { useState } from 'react';
import { Card, PageHeader } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { TierSchedulesSection } from '../components/TierSchedulesSection';
import { FlatRatesSection } from '../components/FlatRatesSection';
import { HoldbackSplitSection } from '../components/HoldbackSplitSection';
import { ReleaseSettingSection } from '../components/ReleaseSettingSection';
import { IncentivesSection } from '../components/IncentivesSection';
import { ScopeSelector } from '../components/ScopeSelector';
import { SCOPE_ALL, type ScopeValue } from '../clientScope';
import styles from '../components/commission.module.css';

export default function CommissionConfigPage() {
  const canView = useCan('commission:view');
  // Client scope for the RATE sections only (tiers + flat rates). The holdback split stays GLOBAL — a
  // per-client split would break the derived "advance + holdback === gross" rounding.
  const [scope, setScope] = useState<ScopeValue>(SCOPE_ALL);
  if (!canView) {
    return <AccessDenied message="Viewing commission config requires the commission view permission." />;
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Commission Configuration"
        subtitle="The rep-commission stream — tiers, flat rates, holdback, and incentives. Effective-dated; changes apply prospectively."
      />
      <Card title="Rate scope">
        <ScopeSelector value={scope} onChange={setScope} />
      </Card>
      <TierSchedulesSection scope={scope} />
      <FlatRatesSection scope={scope} />
      <HoldbackSplitSection />
      <ReleaseSettingSection />
      <IncentivesSection />
    </div>
  );
}
