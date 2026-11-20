/**
 * Commission report helpers — PURE (no React, no clock). The "New report" form schema, the request body it
 * builds, the filter sentinel mapping, and the file-name source for downloads.
 *
 * Client decision 2026-11-16: a report covers a SALE-DATE range (inclusive), optionally one client and/or one
 * rep. The UI computes no money (#1): it only sends the window; the server prices every line.
 */
import { z } from 'zod';
import type { CreatePayRunBody, PayRunSummary } from './payrun.types';

/** Radix Select forbids an empty value, so "All" is this sentinel, mapped to `undefined` (CLAUDE §13.2). */
export const ALL = '__all__';

export const fromSentinel = (v: string | undefined): string | undefined => (!v || v === ALL ? undefined : v);

export const newReportSchema = z
  .object({
    date_from: z.string().min(1, 'Choose a start date.'),
    date_to: z.string().min(1, 'Choose an end date.'),
    client_id: z.string(),
    rep_id: z.string(),
    label: z.string().max(120, 'Keep the name under 120 characters.'),
  })
  // 'YYYY-MM-DD' strings compare correctly as text, so no Date (and no timezone) is involved.
  .refine((v) => !v.date_from || !v.date_to || v.date_from <= v.date_to, {
    path: ['date_to'],
    message: 'The end date must be on or after the start date.',
  });

export type NewReportValues = z.infer<typeof newReportSchema>;

export const NEW_REPORT_DEFAULTS: NewReportValues = { date_from: '', date_to: '', client_id: ALL, rep_id: ALL, label: '' };

/** The POST /v1/pay-runs body for a range report. Optional fields are omitted, never sent empty. */
export function toCreateBody(v: NewReportValues): CreatePayRunBody {
  const label = v.label.trim();
  const clientId = fromSentinel(v.client_id);
  const repId = fromSentinel(v.rep_id);
  return {
    date_from: v.date_from,
    date_to: v.date_to,
    ...(clientId ? { client_id: clientId } : {}),
    ...(repId ? { rep_id: repId } : {}),
    ...(label ? { label } : {}),
  };
}

/** The refresh body for an existing draft: its own window, so the server reuses (refreshes) that draft. */
export function refreshBody(run: PayRunSummary): CreatePayRunBody {
  if (run.kind === 'period' && run.pay_period_id) return { pay_period_id: run.pay_period_id };
  return {
    date_from: run.window_start,
    date_to: run.window_end,
    ...(run.client_id ? { client_id: run.client_id } : {}),
    ...(run.rep_id ? { rep_id: run.rep_id } : {}),
  };
}

/** What the report is limited to, in words ("All clients · All reps"). */
export function scopeLabel(run: Pick<PayRunSummary, 'kind' | 'client' | 'scope_rep'>): string {
  if (run.kind === 'period') return 'Pay period';
  const client = run.client ? run.client.name : 'All clients';
  const rep = run.scope_rep ? run.scope_rep.full_name : 'All reps';
  return `${client} · ${rep}`;
}

/** The `source` part of a download's file name (exportFilename adds the date). */
export function fileSource(run: Pick<PayRunSummary, 'kind' | 'pay_period' | 'window_start' | 'window_end'>, what: string): string {
  if (run.kind === 'period' && run.pay_period) return `${what}-period-${run.pay_period.period_number}`;
  return `${what}-${run.window_start}_${run.window_end}`;
}

/** The phrase typed to confirm "Mark as paid" (ConfirmDialog `requireTyped`). */
export const MARK_PAID_PHRASE = 'MARK PAID';

/** The download path with only the filters that are set. */
export function payrollDownloadPath(runId: string, clientId?: string, repId?: string): string {
  const q = new URLSearchParams();
  if (clientId) q.set('client_id', clientId);
  if (repId) q.set('rep_id', repId);
  const qs = q.toString();
  return `/v1/pay-runs/${runId}/payroll-report/download${qs ? `?${qs}` : ''}`;
}
