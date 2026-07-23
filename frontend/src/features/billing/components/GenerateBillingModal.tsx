/**
 * GenerateBillingModal — select a client + BILLING WEEK, PREVIEW the exact rows that would be issued (one per
 * sale, per-component, no GST), then ISSUE. The UI PRICES NOTHING (#1/#3) — preview + generate are backend calls. Generation
 * ISSUES a NEW gapless-numbered IMMUTABLE statement (+ paired invoice); any prior version is superseded (kept
 * for the record — never mutated). An unpriced product → 422 → a helpful UnpricedBanner. On success → the
 * statement detail page. billing:create-gated; the server is the real gate (§5).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Modal, Table, TBody, TD, TH, THead, TR, useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { money } from '../../../lib/format/money';
import { useStatements } from '../api/useBilling';
import { useGenerateInvoice, useGenerateStatement, usePreviewStatement } from '../api/useBillingMutations';
import { extractUnpriced } from '../billing.logic';
import { ClientPeriodPicker } from './ClientPeriodPicker';
import { UnpricedBanner } from './UnpricedBanner';
import styles from './billing.module.css';
import type { Client } from '../../clients/clients.types';
import type { BillingPeriod, StatementPreview, UnpricedDetail } from '../billing.types';

interface Props {
  open: boolean;
  onClose: () => void;
  clients: Client[];
  periods: BillingPeriod[];
  presetClientId?: string;
  presetPeriodId?: string;
}

export function GenerateBillingModal({ open, onClose, clients, periods, presetClientId, presetPeriodId }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const [clientId, setClientId] = useState<string | undefined>(presetClientId);
  const [periodId, setPeriodId] = useState<string | undefined>(presetPeriodId);
  const [unpriced, setUnpriced] = useState<UnpricedDetail[] | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const previewMut = usePreviewStatement();
  const genStmt = useGenerateStatement();
  const genInv = useGenerateInvoice();

  useEffect(() => {
    if (open) {
      setClientId(presetClientId);
      setPeriodId(presetPeriodId);
      setUnpriced(null);
      setPreview(null);
    }
  }, [open, presetClientId, presetPeriodId]);

  const existing = useStatements({ client_id: clientId, billing_period_id: periodId }, open && !!clientId && !!periodId);
  const alreadyExists = (existing.data ?? []).length > 0;
  const busy = previewMut.isPending || genStmt.isPending || genInv.isPending;

  const reset = () => {
    setPreview(null);
    setUnpriced(null);
  };

  const onPreview = () => {
    if (!clientId || !periodId) return;
    setUnpriced(null);
    previewMut.mutate(
      { clientId, body: { billing_period_id: periodId } },
      {
        onSuccess: (p) => setPreview(p),
        onError: (err) => {
          const u = extractUnpriced(err);
          if (u) setUnpriced(u);
          else onError(err);
        },
      },
    );
  };

  const onIssue = () => {
    if (!clientId || !periodId) return;
    genStmt.mutate(
      { clientId, body: { billing_period_id: periodId } },
      {
        onSuccess: (statement) => {
          genInv.mutate(
            { clientId, body: { billing_period_id: periodId } },
            {
              onSuccess: () => {
                toast({ title: 'Statement & invoice issued', tone: 'success' });
                onClose();
                navigate(`/billing/statements/${statement.id}`);
              },
              onError: () => {
                toast({ title: 'Statement issued — re-issue to refresh the invoice', tone: 'warning' });
                onClose();
                navigate(`/billing/statements/${statement.id}`);
              },
            },
          );
        },
        onError: (err) => {
          const u = extractUnpriced(err);
          if (u) setUnpriced(u);
          else onError(err);
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title="Generate statement & invoice"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {preview ? (
            <Button variant="primary" type="button" onClick={onIssue} loading={genStmt.isPending || genInv.isPending} disabled={busy}>
              {alreadyExists ? 'Issue new version' : 'Generate & issue'}
            </Button>
          ) : (
            <Button variant="primary" type="button" onClick={onPreview} loading={previewMut.isPending} disabled={busy || !clientId || !periodId}>
              Preview
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
          onClient={(v) => { setClientId(v); reset(); }}
          onPeriod={(v) => { setPeriodId(v); reset(); }}
          disabled={busy || !!preview}
        />

        {alreadyExists && !preview && (
          <Banner tone="info" title="A statement already exists for this client + week">
            Issuing again creates a <strong>new numbered version</strong>; the current one is kept (superseded) for the record — it is never changed.
          </Banner>
        )}

        {unpriced && <UnpricedBanner unpriced={unpriced} clientId={clientId} />}

        {preview && (
          <>
            <Banner tone="info" title="Preview — not yet issued">
              {preview.summary.line_count} sale(s) · {preview.summary.internet_count} internet ·{' '}
              {preview.summary.tv_count} TV · {preview.summary.home_phone_count} home phone · total{' '}
              {money(preview.total_amount)}. No GST. Issuing mints a new gapless number.
            </Banner>
            {preview.lines.length > 0 ? (
              <Table maxHeight="40vh">
                <THead>
                  <TR>
                    <TH>Sale date</TH>
                    <TH>Customer</TH>
                    <TH>Product</TH>
                    <TH align="right">Internet</TH>
                    <TH align="right">TV</TH>
                    <TH align="right">HP</TH>
                    <TH align="right">Bundle</TH>
                    <TH align="right">Spiff</TH>
                    <TH align="right">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {preview.lines.map((l) => (
                    <TR key={l.sale_id}>
                      <TD><span className="mono">{l.sale_date}</span></TD>
                      <TD>{`${l.customer_first_name} ${l.customer_last_name}`.trim() || l.customer_name}</TD>
                      <TD>{l.product_name || l.products_summary}</TD>
                      <TD numeric>{money(l.internet_rate)}</TD>
                      <TD numeric>{money(l.tv_rate)}</TD>
                      <TD numeric>{money(l.hp_rate)}</TD>
                      <TD numeric>{money(l.bundle_bonus)}</TD>
                      <TD numeric>{money(l.spiff)}</TD>
                      <TD numeric>{money(l.line_total)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="mono">No billable sales for this client + week.</p>
            )}
          </>
        )}

        <p className={styles.note}>
          The server prices every component — internet, TV, home phone, bundle and spiff — from client billing
          rates effective on each sale’s own date. This screen computes nothing.
        </p>
      </div>
    </Modal>
  );
}
