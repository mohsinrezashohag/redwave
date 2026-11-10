/**
 * PeriodConfigPage — /admin/period-configs. The pay and billing CALENDARS as admin configuration.
 *
 * Two calendars, never substituted for one another (§14 rule 1). Pay periods govern rep pay; billing weeks
 * govern client billing and are numbered sequentially. The one-day boundary offset between them is
 * deliberate, and the overlap panel makes it visible rather than leaving it to be discovered mid-
 * reconciliation.
 *
 * FORWARD-ONLY. Recording a shape moves nothing; regeneration is a separate, guarded action that refuses
 * any period holding a finalized pay run or an issued statement/invoice. The server is the real gate — the
 * preview here is a courtesy so an admin sees the refusal before attempting it, not the control itself
 * (§5). A 422 carries `blocked[]`, which is rendered rather than buried in a toast (§13.5).
 *
 * Read `payrun:view`; write `settings:edit`. The UI computes no dates — every period shown is the
 * server's.
 */
import { useState } from 'react';
import { AlertTriangle, CalendarCog, RefreshCw } from 'lucide-react';
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  PageHeader,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { ApiError, isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import {
  useCalendarOverlap,
  usePeriodConfigs,
  usePreviewRegeneration,
  useRegenerate,
} from '../api/usePeriodConfig';
import { PeriodConfigModal } from '../components/PeriodConfigModal';
import type { BlockedPeriod, PeriodKind, RegenerationPlan } from '../periodConfig.types';
import styles from '../components/periodConfig.module.css';

const KIND_LABEL: Record<PeriodKind, string> = { pay: 'Pay periods', billing: 'Billing weeks' };

/** Pull `blocked[]` off a 422 so the refusal can be shown as a list, not a sentence. */
function blockedFrom(error: unknown): BlockedPeriod[] {
  const details = error instanceof ApiError ? (error.details as { blocked?: unknown } | undefined) : undefined;
  return Array.isArray(details?.blocked) ? (details.blocked as BlockedPeriod[]) : [];
}

export default function PeriodConfigPage() {
  const canView = useCan('payrun:view');
  const canEdit = useCan('settings:edit');
  const { toast } = useToast();
  const onError = useApiErrorToast();

  const [kind, setKind] = useState<PeriodKind>('pay');
  const [count, setCount] = useState('26');
  const [modalOpen, setModalOpen] = useState(false);
  const [plan, setPlan] = useState<RegenerationPlan | null>(null);
  const [blocked, setBlocked] = useState<BlockedPeriod[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [overlapPeriod, setOverlapPeriod] = useState('1');

  const configs = usePeriodConfigs(canView);
  const preview = usePreviewRegeneration();
  const regenerate = useRegenerate();
  const overlap = useCalendarOverlap(Number(overlapPeriod) || undefined, canView);

  if (!canView || isForbidden(configs.error)) return <AccessDenied />;

  const onPreview = () => {
    setBlocked([]);
    preview.mutate(
      { kind, count: Number(count) },
      {
        onSuccess: (data) => {
          setPlan(data);
          setBlocked(data.blocked);
        },
        onError,
      },
    );
  };

  const onApply = () => {
    regenerate.mutate(
      { kind, count: Number(count) },
      {
        onSuccess: (data) => {
          setPlan(data);
          setBlocked([]);
          setConfirmOpen(false);
          toast({ title: `${data.periods.length} ${KIND_LABEL[kind].toLowerCase()} regenerated`, tone: 'success' });
        },
        onError: (e: unknown) => {
          // The refusal is the feature — render it rather than reducing it to a toast.
          setBlocked(blockedFrom(e));
          setConfirmOpen(false);
          onError(e);
        },
      },
    );
  };

  const rows = configs.data ?? [];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Period calendars"
        subtitle="Define the pay and billing cycles. Changes apply to future periods only — a period holding a finalized pay run or an issued document is never moved."
        actions={
          canEdit ? (
            <Button variant="primary" leftIcon={<CalendarCog size={16} />} onClick={() => setModalOpen(true)}>
              Set a calendar
            </Button>
          ) : undefined
        }
      />

      <Banner tone="info" title="Recording a shape does not move anything">
        A calendar shape is configuration. Periods change only when you regenerate below, and regeneration
        refuses any period that is already frozen by a finalized pay run or an issued statement or invoice.
      </Banner>

      <Card title="Configured shapes">
        <DataState
          isLoading={configs.isLoading}
          isError={configs.isError}
          isEmpty={rows.length === 0}
          onRetry={() => configs.refetch()}
          emptyNode={
            <p className={styles.note}>
              No custom calendars — both cycles use the seeded defaults: pay periods run Sunday–Saturday
              every 14 days with payday 13 days after close; billing weeks run Monday–Sunday.
            </p>
          }
        >
          <Table>
            <THead>
              <TR>
                <TH>Calendar</TH>
                <TH>Anchor</TH>
                <TH align="right">Length</TH>
                <TH align="right">Payday offset</TH>
                <TH>Effective from</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Badge tone="neutral">{KIND_LABEL[r.kind]}</Badge>
                  </TD>
                  <TD>{displayDate(r.anchor_date)}</TD>
                  <TD numeric>{r.length_days} days</TD>
                  <TD numeric>{r.payday_offset_days === null ? '—' : `+${r.payday_offset_days} days`}</TD>
                  <TD>{displayDate(r.effective_from)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </DataState>
      </Card>

      <Card title="Regenerate future periods">
        <div className={styles.controls}>
          <Select
            aria-label="Calendar"
            value={kind}
            onValueChange={(v) => {
              setKind(v as PeriodKind);
              setPlan(null);
              setBlocked([]);
            }}
            options={[
              { value: 'pay', label: 'Pay periods' },
              { value: 'billing', label: 'Billing weeks' },
            ]}
          />
          <Select
            aria-label="How many periods"
            value={count}
            onValueChange={setCount}
            options={['13', '26', '52'].map((n) => ({ value: n, label: `${n} periods` }))}
          />
          <Button variant="secondary" onClick={onPreview} loading={preview.isPending}>
            Preview
          </Button>
          {canEdit && plan && blocked.length === 0 && (
            <Button variant="primary" leftIcon={<RefreshCw size={16} />} onClick={() => setConfirmOpen(true)}>
              Apply
            </Button>
          )}
        </div>

        {blocked.length > 0 && (
          <Banner tone="danger" title="Cannot regenerate — these periods are frozen">
            Each of these holds a finalized pay run or an issued document. Moving its boundary would break
            a record that is already committed, so nothing was changed.
            <ul className={styles.blockedList}>
              {blocked.map((b) => (
                <li key={b.period_number}>
                  <strong>Period {b.period_number}</strong> ({displayDate(b.start_date)} –{' '}
                  {displayDate(b.end_date)}) — {b.reason}
                </li>
              ))}
            </ul>
          </Banner>
        )}

        {plan && blocked.length === 0 && (
          <>
            <p className={styles.note}>
              {plan.periods.length} periods from <strong>#{plan.from_period}</strong>, anchored{' '}
              {displayDate(plan.shape.anchor_date)}, {plan.shape.length_days} days each
              {plan.shape.payday_offset_days === null ? '' : `, payday +${plan.shape.payday_offset_days} days`}.
            </p>
            <Table maxHeight="40vh">
              <THead>
                <TR>
                  <TH align="right">#</TH>
                  <TH>Start</TH>
                  <TH>End</TH>
                  {kind === 'pay' && <TH>Payday</TH>}
                </TR>
              </THead>
              <TBody>
                {plan.periods.map((p) => (
                  <TR key={p.period_number}>
                    <TD numeric>{p.period_number}</TD>
                    <TD>{displayDate(p.start_date)}</TD>
                    <TD>{displayDate(p.end_date)}</TD>
                    {kind === 'pay' && <TD>{p.payday ? displayDate(p.payday) : '—'}</TD>}
                  </TR>
                ))}
              </TBody>
            </Table>
          </>
        )}
      </Card>

      {/* The two-calendar boundary, surfaced rather than discovered mid-reconciliation (§14 rule 1). */}
      <Card title="How billing weeks map into a pay period">
        <div className={styles.controls}>
          <Select
            aria-label="Pay period"
            value={overlapPeriod}
            onValueChange={setOverlapPeriod}
            options={Array.from({ length: 26 }, (_, i) => ({
              value: String(i + 1),
              label: `Pay period ${i + 1}`,
            }))}
          />
        </div>
        {overlap.data && (
          <>
            <p className={styles.note}>
              Pay period {overlap.data.pay_period_number}: {displayDate(overlap.data.pay_start)} –{' '}
              {displayDate(overlap.data.pay_end)}
            </p>
            <Table>
              <THead>
                <TR>
                  <TH align="right">Bill</TH>
                  <TH>Week</TH>
                  <TH>Fits inside?</TH>
                </TR>
              </THead>
              <TBody>
                {overlap.data.billing_periods.map((b) => (
                  <TR key={b.billing_period_number}>
                    <TD numeric>{b.billing_period_number}</TD>
                    <TD>
                      {displayDate(b.start_date)} – {displayDate(b.end_date)}
                    </TD>
                    <TD>
                      {b.fully_inside ? (
                        <Badge tone="success">Whole week</Badge>
                      ) : (
                        <Badge tone="warning">
                          <AlertTriangle size={12} aria-hidden /> Crosses the boundary
                        </Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className={styles.note}>
              A week marked <em>crosses the boundary</em> is split across two pay periods. This is expected
              — the calendars have different anchors and lengths — so a pay period will never reconcile
              exactly against a billing week.
            </p>
          </>
        )}
      </Card>

      {canEdit && modalOpen && <PeriodConfigModal open onClose={() => setModalOpen(false)} />}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Regenerate ${plan?.periods.length ?? 0} ${KIND_LABEL[kind].toLowerCase()}?`}
        description="Future periods only. Any period already holding a finalized pay run or an issued document is refused, and nothing is changed if even one is."
        confirmLabel="Regenerate"
        requireTyped="REGENERATE"
        loading={regenerate.isPending}
        onConfirm={onApply}
      />
    </div>
  );
}
