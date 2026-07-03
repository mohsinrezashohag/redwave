/**
 * ClawbackEntryPage — /clawbacks/new. Find a PAID sale → pick the cancelled item → record the recovery.
 * The recovery amount is the SERVER's (blank → server computes from the snapshot, #1/#6); the snapshot is
 * never edited (#2); the reported date is informational (#6); per-item, no re-tier (#5). `clawback:create`
 * to record; `sales:view` to search. 403 → AccessDenied; the server is the real gate (§5).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Card, PageHeader } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { DataState } from '../../../components/data/DataState';
import { isForbidden } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useReps, useSalesQuery } from '../../sales/api/useSales';
import { PaidSaleFinder } from '../components/PaidSaleFinder';
import { PaidItemsPanel } from '../components/PaidItemsPanel';
import { ClawbackEntryModal } from '../components/ClawbackEntryModal';
import { isClawable } from '../clawback.logic';
import styles from '../components/clawback.module.css';
import type { Sale, SaleItem } from '../../sales/sales.types';

export default function ClawbackEntryPage() {
  const canCreate = useCan('clawback:create');
  const canViewSales = useCan('sales:view');
  const canSeeReps = useCan('hrm:view');
  const navigate = useNavigate();

  // Clawable items live on paid sales AND partially-clawed sales (a sale flips to clawed_back when one item
  // is recovered, but its other paid items stay clawable). Fetch both; keep sales with >=1 clawable item.
  const paidQ = useSalesQuery({ status: 'paid' });
  const clawedQ = useSalesQuery({ status: 'clawed_back' });
  // Rep names disambiguate two reps at the same address (CLAW-009). hrm:view-gated; degrade to a short id.
  const repsQ = useReps(canSeeReps);
  const [text, setText] = useState('');
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [clawItem, setClawItem] = useState<SaleItem | null>(null);

  const repById = useMemo(
    () => new Map((repsQ.data ?? []).map((r) => [r.id, `${r.full_name} (${r.rep_code})`])),
    [repsQ.data],
  );
  const repLabelById = (repId: string): string => repById.get(repId) ?? `${repId.slice(0, 8)}…`;

  const clawableSales = useMemo<Sale[]>(() => {
    const merged = [...(paidQ.data ?? []), ...(clawedQ.data ?? [])];
    return merged.filter((s) => s.sale_items.some(isClawable));
  }, [paidQ.data, clawedQ.data]);

  const rows = useMemo<Sale[]>(() => {
    const t = text.trim().toLowerCase();
    // Search Sale ID, customer, ADDRESS (street/city), or REP name (CLAW-009).
    const filtered = t
      ? clawableSales.filter((s) =>
          [s.sale_code, s.customer_name, s.street, s.city, repLabelById(s.rep_id)]
            .some((field) => field?.toLowerCase().includes(t)),
        )
      : clawableSales;
    return [...filtered].sort((a, b) => b.sale_date.localeCompare(a.sale_date));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repLabelById derives from repById (stable per data)
  }, [clawableSales, text, repById]);

  const selectedSale = clawableSales.find((s) => s.id === selectedSaleId) ?? null;

  if (!canCreate || isForbidden(paidQ.error) || isForbidden(clawedQ.error)) {
    return <AccessDenied message="Recording a clawback requires the clawback create permission." />;
  }
  if (!canViewSales) {
    return (
      <div className={styles.page}>
        <PageHeader title="Record a clawback" />
        <Banner tone="warning" title="Sales view required">
          Finding a paid sale to claw back needs the sales view permission. Ask an administrator.
        </Banner>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Record a clawback"
        subtitle="Find a paid sale, pick the cancelled item, and record the recovery. The amount is computed by the server from the frozen snapshot."
        actions={
          <Button variant="tertiary" onClick={() => navigate('/clawbacks')}>
            View clawbacks
          </Button>
        }
      />

      <Card title="Find a paid sale">
        <DataState
          isLoading={paidQ.isLoading || clawedQ.isLoading}
          isError={paidQ.isError || clawedQ.isError}
          isEmpty={rows.length === 0}
          onRetry={() => {
            paidQ.refetch();
            clawedQ.refetch();
          }}
          emptyNode={<p className="mono">No paid sales with a clawable item.</p>}
        >
          <PaidSaleFinder
            text={text}
            onText={setText}
            rows={rows}
            repLabelById={repLabelById}
            selectedSaleId={selectedSaleId}
            onSelect={setSelectedSaleId}
          />
        </DataState>
      </Card>

      {selectedSale && (
        <Card title="Select the cancelled item">
          <PaidItemsPanel sale={selectedSale} onClawback={setClawItem} />
        </Card>
      )}

      <ClawbackEntryModal saleItem={clawItem} saleCode={selectedSale?.sale_code} onClose={() => setClawItem(null)} />
    </div>
  );
}
