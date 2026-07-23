/**
 * GenerateExpenseDocModal — select a client + period, PREVIEW the grouped km + food lines (per rep/day),
 * optionally narrow which reps/days to include, then ISSUE. The UI PRICES NOTHING (#1/#3) — preview + generate
 * are backend calls. km is priced from the CLIENT-BILL km rate, food is native-currency (mismatches surfaced
 * in an "excluded" banner). Generation ISSUES a NEW gapless CEXP-numbered IMMUTABLE document; a prior version
 * is superseded (kept — never mutated). A km item with no client-bill rate → 422 (toast). For a FOREIGN client
 * an FX rate freezes at issue. On success → the document detail page. billing:create-gated (server is the real
 * gate, §5).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, FormField, Input, Modal, MultiSelect, useToast } from '../../../components/ui';
import { ApiError, useApiErrorToast } from '../../../lib/api/apiError';
import { MissingKmRateBanner, type MissingKmRate } from './MissingKmRateBanner';
import { money } from '../../../lib/format/money';
import { ClientPeriodPicker } from '../../billing/components/ClientPeriodPicker';
import { useExpenseDocs, useGenerateExpenseDoc, usePreviewExpenseDoc } from '../api/useExpenseDocs';
import { ExpenseDocLinesTable } from './ExpenseDocLinesTable';
import styles from './expenseDocs.module.css';
import type { Client } from '../../clients/clients.types';
import type { PayPeriod } from '../../payrun/payrun.types';
import type { ExpenseDocPreview } from '../expenseDocs.types';

interface Props {
  open: boolean;
  onClose: () => void;
  clients: Client[];
  periods: PayPeriod[];
  presetClientId?: string;
  presetPeriodId?: string;
}

/**
 * Pull the structured `missing_km_rate[]` out of a generate 422 (carried on ApiError.details). Returns null
 * for any other error so the caller falls back to a normal error toast. Pure.
 */
function extractMissingKmRate(error: unknown): MissingKmRate[] | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const details = error.details;
  if (!details || typeof details !== 'object' || !('missing_km_rate' in details)) return null;
  const list = (details as { missing_km_rate?: unknown }).missing_km_rate;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list as MissingKmRate[];
}

export function GenerateExpenseDocModal({ open, onClose, clients, periods, presetClientId, presetPeriodId }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  // The km-rate refusal is a CONFIG problem, not a failure to report as a toast that scrolls away — it
  // carries the unpriced dates, so surface them with a link to the screen that fixes it (#13).
  const [missingKmRate, setMissingKmRate] = useState<MissingKmRate[] | null>(null);
  const handleError = (err: unknown) => {
    const missing = extractMissingKmRate(err);
    if (missing) setMissingKmRate(missing);
    else onError(err);
  };
  const [clientId, setClientId] = useState<string | undefined>(presetClientId);
  const [periodId, setPeriodId] = useState<string | undefined>(presetPeriodId);
  const [repIds, setRepIds] = useState<string[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [fxRate, setFxRate] = useState('');
  const [preview, setPreview] = useState<ExpenseDocPreview | null>(null);
  // The full rep/day option set, captured from the FIRST (unfiltered) preview so narrowing never shrinks it.
  const [allReps, setAllReps] = useState<{ id: string; name: string }[]>([]);
  const [allDates, setAllDates] = useState<string[]>([]);
  const previewMut = usePreviewExpenseDoc();
  const genMut = useGenerateExpenseDoc();

  useEffect(() => {
    if (open) {
      setClientId(presetClientId);
      setPeriodId(presetPeriodId);
      setRepIds([]);
      setDates([]);
      setFxRate('');
      setPreview(null);
      setAllReps([]);
      setAllDates([]);
    }
  }, [open, presetClientId, presetPeriodId]);

  const client = useMemo(() => clients.find((c) => c.id === clientId), [clients, clientId]);
  const currency = client?.currency ?? 'CAD';
  const isForeign = currency !== 'CAD';

  const existing = useExpenseDocs({ client_id: clientId, pay_period_id: periodId }, open && !!clientId && !!periodId);
  const alreadyExists = (existing.data ?? []).length > 0;
  const busy = previewMut.isPending || genMut.isPending;

  const resetPreview = () => {
    setPreview(null);
    setAllReps([]);
    setAllDates([]);
    setRepIds([]);
    setDates([]);
  };

  const onPreview = () => {
    if (!clientId || !periodId) return;
    setMissingKmRate(null);
    previewMut.mutate(
      { clientId, body: { pay_period_id: periodId, rep_ids: repIds.length ? repIds : undefined, dates: dates.length ? dates : undefined } },
      {
        onSuccess: (p) => {
          setPreview(p);
          // Capture the full option set once (from the unfiltered preview).
          if (allReps.length === 0 && repIds.length === 0 && dates.length === 0) {
            const reps = new Map(p.lines.map((l) => [l.rep_id, l.rep_name]));
            setAllReps([...reps].map(([id, name]) => ({ id, name })));
            setAllDates([...new Set(p.lines.map((l) => l.date))].sort());
          }
        },
        onError: handleError,
      },
    );
  };

  const onIssue = () => {
    if (!clientId || !periodId) return;
    setMissingKmRate(null);
    genMut.mutate(
      {
        clientId,
        body: {
          pay_period_id: periodId,
          rep_ids: repIds.length ? repIds : undefined,
          dates: dates.length ? dates : undefined,
          fx_rate: isForeign && fxRate ? fxRate : undefined,
        },
      },
      {
        onSuccess: (doc) => {
          toast({ title: 'Expense document issued', tone: 'success' });
          onClose();
          navigate(`/billing/expense-documents/${doc.id}`);
        },
        onError: handleError,
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title="Generate expense document"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="tertiary" type="button" onClick={onPreview} loading={previewMut.isPending} disabled={busy || !clientId || !periodId}>
            {preview ? 'Refresh preview' : 'Preview'}
          </Button>
          {preview && (
            <Button variant="primary" type="button" onClick={onIssue} loading={genMut.isPending} disabled={busy}>
              {alreadyExists ? 'Issue new version' : 'Generate & issue'}
            </Button>
          )}
        </div>
      }
    >
      <div className={styles.form}>
        <ClientPeriodPicker
          clients={clients}
          periods={periods}
          clientId={clientId}
          periodId={periodId}
          onClient={(v) => { setClientId(v); resetPreview(); }}
          onPeriod={(v) => { setPeriodId(v); resetPreview(); }}
          disabled={busy}
        />

        {missingKmRate && <MissingKmRateBanner missing={missingKmRate} />}

        {alreadyExists && (
          <Banner tone="info" title="A document already exists for this client + period">
            Issuing again creates a <strong>new numbered version</strong>; the current one is kept (superseded) — it is never changed.
          </Banner>
        )}

        {preview && (allReps.length > 0 || allDates.length > 0) && (
          <div className={styles.controls}>
            <div className={styles.control}>
              <FormField label="Reps (all if none selected)">
                <MultiSelect
                  placeholder="Add a rep…"
                  options={allReps.map((r) => ({ value: r.id, label: r.name }))}
                  value={repIds}
                  onChange={setRepIds}
                />
              </FormField>
            </div>
            <div className={styles.control}>
              <FormField label="Days (all if none selected)">
                <MultiSelect
                  placeholder="Add a day…"
                  options={allDates.map((dd) => ({ value: dd, label: dd }))}
                  value={dates}
                  onChange={setDates}
                />
              </FormField>
            </div>
          </div>
        )}
        {preview && (repIds.length > 0 || dates.length > 0) && (
          <p className={styles.note}>Selection changed — click <strong>Refresh preview</strong> to update the total before issuing.</p>
        )}

        {isForeign && (
          <FormField label={`FX rate (${currency} → CAD)`} help="Frozen at issue. Leave blank to use the configured FX source (else issuing is rejected).">
            <Input value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="1.36500000" inputMode="decimal" />
          </FormField>
        )}

        {preview && preview.excluded.length > 0 && (
          <Banner tone="warning" title={`${preview.excluded.length} item(s) excluded`}>
            Food entered in a currency other than {currency} is not billed on this {currency} document (no conversion). Re-enter it in {currency} to include it.
          </Banner>
        )}

        {preview && (
          <>
            <Banner tone="info" title="Preview — not yet issued">
              {preview.lines.length} line(s) · total {money(preview.total_amount, currency)}. Kilometres + food only. Issuing mints a new gapless number.
            </Banner>
            {preview.lines.length > 0 ? (
              <ExpenseDocLinesTable lines={preview.lines} currency={currency} />
            ) : (
              <p className="mono">No billable kilometres or food for this client + period.</p>
            )}
          </>
        )}

        <p className={styles.note}>
          The server prices kilometres from the client-bill km rate (effective by each item’s date) and food at its native amount. No receipts, no commission (#3). This screen computes nothing.
        </p>
      </div>
    </Modal>
  );
}
