/**
 * AI tool catalogue — PURE. The allow-listed functions the Gemini model may call, their Gemini
 * `functionDeclarations`, and the argument sanitizers. — SRS RPT-011, CLAUDE §5
 *
 * SECURITY: no tool takes a person, rep, user or client id. Every tool runs against the CALLER (the
 * AuthUser) and the caller's ScopeService scope. The only free-form identifier a model may pass is a
 * `sale_code`, which the toolbox scope-checks before answering (an out-of-scope code answers exactly like
 * an unknown one, so existence never leaks). Arguments the model invents beyond these are dropped here.
 */
import { SaleStatus } from '@prisma/client';

export const AI_TOOL_NAMES = [
  'my_sales_summary',
  'pending_validation_count',
  'sale_status',
  'my_pay_summary',
  'my_expenses_status',
  'leaderboard_position',
  'team_summary',
  'business_summary',
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];

export function isAiTool(name: string): name is AiToolName {
  return (AI_TOOL_NAMES as readonly string[]).includes(name);
}

/** Sale statuses a model may filter by (deleted / historical are never offered). */
export const FILTERABLE_SALE_STATUSES: readonly SaleStatus[] = ['entered', 'validated', 'in_pay_run', 'paid', 'clawed_back'];

const DATE_RANGE_PROPS = {
  date_from: { type: 'STRING', description: 'Start date YYYY-MM-DD (sale or expense date). Defaults to the current pay period.' },
  date_to: { type: 'STRING', description: 'End date YYYY-MM-DD, inclusive. Defaults to the current pay period.' },
};

/** Gemini REST `functionDeclarations` (OpenAPI-subset schema). */
export const FUNCTION_DECLARATIONS: ReadonlyArray<Record<string, unknown>> = [
  {
    name: 'my_sales_summary',
    description:
      "The asker's OWN sales: counts by status (entered = pending validation, validated, in_pay_run, paid, clawed_back) and approved/pending internet activations, for a date range on sale_date.",
    parameters: {
      type: 'OBJECT',
      properties: {
        ...DATE_RANGE_PROPS,
        status: { type: 'STRING', enum: [...FILTERABLE_SALE_STATUSES], description: 'Only count this status.' },
      },
    },
  },
  {
    name: 'pending_validation_count',
    description:
      'How many sales are entered and waiting for validation, within what the asker can see (their own sales, their team, or the company for admins).',
  },
  {
    name: 'sale_status',
    description: 'Look up one sale by its Sale ID (sale code, e.g. 2026-11-03-VF) and return its status. Only sales the asker can see.',
    parameters: {
      type: 'OBJECT',
      properties: { sale_code: { type: 'STRING', description: 'The Sale ID exactly as shown in Redwave.' } },
      required: ['sale_code'],
    },
  },
  {
    name: 'my_pay_summary',
    description:
      "The asker's OWN most recent finalized pay statement: commission, expenses, incentives, bonus, clawbacks and net payout (CAD).",
  },
  {
    name: 'my_expenses_status',
    description: "The asker's OWN expense items: counts and amounts by status (draft, submitted, approved, rejected, sent_back).",
    parameters: { type: 'OBJECT', properties: { ...DATE_RANGE_PROPS } },
  },
  {
    name: 'leaderboard_position',
    description: "The asker's rank on this pay period's leaderboard with approved and pending internet activation counts. Counts only.",
  },
  {
    name: 'team_summary',
    description:
      "For managers: their roster's sales counts by status and per-rep approved/pending internet activations. For admins: the same, company-wide. Counts only.",
    parameters: { type: 'OBJECT', properties: { ...DATE_RANGE_PROPS } },
  },
  {
    name: 'business_summary',
    description: 'Super Admin only: company revenue, rep payout and net margin for the current period.',
  },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A 'YYYY-MM-DD' string that is a real calendar date, else undefined. */
export function cleanDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? undefined : value;
}

export function cleanStatus(value: unknown): SaleStatus | undefined {
  return typeof value === 'string' && (FILTERABLE_SALE_STATUSES as readonly string[]).includes(value)
    ? (value as SaleStatus)
    : undefined;
}

/** A plausible sale code (trimmed, bounded, no whitespace inside), else undefined. */
export function cleanSaleCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim();
  return code.length > 0 && code.length <= 64 && /^[A-Za-z0-9._-]+$/.test(code) ? code : undefined;
}

export function asArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
