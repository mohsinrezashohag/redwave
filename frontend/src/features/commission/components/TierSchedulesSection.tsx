/**
 * TierSchedulesSection — the effective-dated tier schedules in the shared EffectiveDatedTable (current /
 * pending / past). "Add schedule" opens the bracket editor (supersedes). A PENDING schedule can be Deleted
 * (ConfirmDialog) — to change one, delete it and add a new one (the bracket editor is the create surface).
 * The server is the real gate (current/past → 422). Reuses the Session-1 component (#10).
 *
 * "Use tier schedule" switch (client request 2026-11-11). Per scope (Global or one client):
 *   - ON  → the tier ladder, as before;
 *   - OFF → BASE PRICES: every internet sale pays its product's own price (else the scope's default),
 *           whatever the volume. Stored as one [0,∞) bracket + tier-1 product prices; the engine is unchanged.
 * Flipping it opens a dated form — nothing changes until that is saved, and past periods never change (#10).
 * The switch is disabled on "All scopes": a scope must be picked first.
 */
import { useState } from 'react';
import { Button, Card, ConfirmDialog, EffectiveDatedTable, Switch, useToast, type EffectiveColumn } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { displayDate } from '../../../lib/format/date';
import styles from './commission.module.css';
import { useClients, useTierRates, useTierSchedules } from '../api/useCommission';
import { useDeleteTierSchedule } from '../api/useCommissionMutations';
import { TierScheduleModal } from './TierScheduleModal';
import { BasePricesModal } from './BasePricesModal';
import { PendingRowActions } from './PendingRowActions';
import { SCOPE_ALL, SCOPE_GLOBAL, scopeDefaultClientId, scopeLabel, scopeParam, type ScopeValue } from '../clientScope';
import { isBasePriceSchedule } from '../tierMode';
import { useScopeTierMode } from '../api/useScopeTierMode';
import type { TierConfig, TierBracket } from '../commission.types';

function rateRange(tiers: TierBracket[]): string {
  if (tiers.length === 0) return '—';
  const rates = tiers.map((t) => Number(t.rate_per_activation));
  const min = Math.min(...rates).toFixed(2);
  const max = Math.max(...rates).toFixed(2);
  return `${money(min)}–${money(max)}`;
}

/** A schedule as one line: a ladder's range, or "base prices" for the single-bracket form. */
function describe(c: TierConfig): string {
  return isBasePriceSchedule(c)
    ? `Base prices · default ${money(c.tiers[0].rate_per_activation)} per activation`
    : `${c.tiers.length} tiers · ${rateRange(c.tiers)} per activation`;
}

type Dialog = 'add' | 'tiers_on' | 'tiers_off' | 'edit_prices' | null;

export function TierSchedulesSection({ scope = SCOPE_ALL }: { scope?: ScopeValue }) {
  const canEdit = useCan('commission:edit');
  const canViewClients = useCan('clients:view');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const remove = useDeleteTierSchedule();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const q = useTierSchedules(scopeParam(scope));
  const clients = useClients(canViewClients);

  const clientId = scopeDefaultClientId(scope);
  const isAll = scope === SCOPE_ALL;
  // The scope's mode (a client with no schedule of its own follows Global). Null on "All scopes".
  const tierMode = useScopeTierMode(scope);
  const basePrices = tierMode.mode === 'base_prices';
  const productPrices = useTierRates('current', clientId, undefined, basePrices && !!clientId && !tierMode.inherited);
  const scopeName = scope === SCOPE_GLOBAL ? 'Global' : scopeLabel(clientId, clients.data);

  const columns: EffectiveColumn<TierConfig>[] = [
    // Only worth a column when scopes are mixed — a single-scope view already says which in the selector.
    ...(isAll ? [{ header: 'Applies to', render: (c: TierConfig) => scopeLabel(c.client_id, clients.data) }] : []),
    { header: 'Schedule', render: (c) => describe(c) },
  ];
  const rows = q.data ?? [];

  const onConfirmDelete = () => {
    if (!deleteId) return;
    remove.mutate(deleteId, {
      onSuccess: () => { toast({ title: 'Tier schedule deleted', tone: 'success' }); setDeleteId(null); },
      onError: (e) => { onError(e); setDeleteId(null); },
    });
  };

  // No switch on "All scopes": scopes can differ, so an on/off state there would be meaningless.
  const toggle = canEdit && !isAll ? (
    <Switch
      label="Use tier schedule"
      checked={tierMode.mode !== 'base_prices'}
      disabled={tierMode.mode === null}
      onCheckedChange={(on) => setDialog(on ? 'tiers_on' : 'tiers_off')}
    />
  ) : undefined;

  return (
    <Card
      title="Tier schedule"
      actions={
        canEdit ? (
          <div className={styles.cardActions}>
            {toggle}
            {!basePrices && <Button variant="secondary" size="sm" onClick={() => setDialog('add')}>Add schedule</Button>}
          </div>
        ) : undefined
      }
    >
      {isAll && canEdit && (
        <p className={styles.note}>
          Showing every scope. To turn tiers on or off, pick <strong>Global</strong> or a client under Rate scope.
        </p>
      )}

      {!isAll && basePrices && tierMode.current && (
        <div className={styles.basePrices}>
          <p className={styles.note}>
            <strong>Tiers are off{tierMode.inherited ? ' (following Global)' : ''}.</strong> Every internet sale pays its
            product&rsquo;s base price, whatever the volume. Since {displayDate(tierMode.current.effective_from)}.
          </p>
          <dl className={styles.basePriceList}>
            <dt>Default price</dt>
            <dd className="mono">{money(tierMode.current.tiers[0].rate_per_activation)}</dd>
            {(productPrices.data ?? [])
              .filter((r) => r.tier_number === 1)
              .map((r) => (
                <div key={r.id} className={styles.basePriceRow}>
                  <dt>{r.product?.name ?? 'Product'}</dt>
                  <dd className="mono">{money(r.amount)}</dd>
                </div>
              ))}
          </dl>
          {canEdit && (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setDialog('edit_prices')}>
                {tierMode.inherited ? 'Set own prices for this client' : 'Edit prices'}
              </Button>
            </div>
          )}
        </div>
      )}

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={rows.length === 0}
        onRetry={() => q.refetch()}
        emptyNode={
          <p className={styles.note}>
            {clientId
              ? 'No schedule of its own. This client follows the Global setting.'
              : 'No tier schedule yet.'}
          </p>
        }
      >
        <EffectiveDatedTable
          rows={rows}
          columns={columns}
          rowActions={canEdit ? (c) => <PendingRowActions status={c.status} onDelete={() => setDeleteId(c.id)} /> : undefined}
        />
      </DataState>

      {canEdit && (dialog === 'add' || dialog === 'tiers_on') && (
        <TierScheduleModal
          open
          defaultClientId={clientId}
          endBasePrices={dialog === 'tiers_on'}
          onClose={() => setDialog(null)}
        />
      )}
      {canEdit && (dialog === 'tiers_off' || dialog === 'edit_prices') && (
        <BasePricesModal
          clientId={clientId}
          scopeName={scopeName}
          switching={dialog === 'tiers_off'}
          defaultRate={
            basePrices
              ? tierMode.current?.tiers[0].rate_per_activation
              : undefined
          }
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete pending schedule?"
        description="Removes the future-dated tier schedule before it takes effect. To change it, delete and add a new one."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={onConfirmDelete}
      />
    </Card>
  );
}
