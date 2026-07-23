/**
 * Tier form shapes + pure mappers shared by TierScheduleModal + TierBracketEditor (avoids a circular
 * import). Bracket fields are strings in the form (so empties are catchable) and parsed to numbers for
 * validation/submit. The default is the Schedule-C-v2 shape. STORAGE only — no tiering logic (#5).
 */
import type { BracketInput } from '../tiers.logic';
import type { CreateTierScheduleBody } from '../commission.types';

export interface BracketForm {
  tier_number: string;
  min_count: string;
  max_count: string;
  open: boolean; // open-ended top (max = null)
  rate_per_activation: string;
}

export interface TierFormValues {
  /** 'all' = the GLOBAL row (client_id omitted); 'specific' = one client's own ladder. */
  scope_mode: 'all' | 'specific';
  client_id?: string;
  effective_from: string;
  effective_to: string;
  tiers: BracketForm[];
}

export function blankBracket(): BracketForm {
  return { tier_number: '', min_count: '', max_count: '', open: false, rate_per_activation: '' };
}

export const DEFAULT_TIERS: BracketForm[] = [
  { tier_number: '4', min_count: '0', max_count: '6', open: false, rate_per_activation: '110.00' },
  { tier_number: '3', min_count: '7', max_count: '16', open: false, rate_per_activation: '125.00' },
  { tier_number: '2', min_count: '17', max_count: '35', open: false, rate_per_activation: '145.00' },
  { tier_number: '1', min_count: '36', max_count: '', open: true, rate_per_activation: '160.00' },
];

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** Map form brackets → the validation input shape (max null when "open"). */
export function toBracketInputs(tiers: BracketForm[]): BracketInput[] {
  return tiers.map((t) => ({
    tier_number: Number(t.tier_number) || 0,
    min_count: num(t.min_count),
    max_count: t.open ? null : num(t.max_count),
    rate_per_activation: t.rate_per_activation,
  }));
}

/** Map validated form values → the API request body. "All clients" omits client_id = the GLOBAL row. */
export function buildTierBody(values: TierFormValues): CreateTierScheduleBody {
  return {
    client_id: values.scope_mode === 'specific' ? values.client_id : undefined,
    effective_from: values.effective_from,
    effective_to: values.effective_to || undefined,
    tiers: values.tiers.map((t) => ({
      tier_number: Number(t.tier_number),
      min_count: Number(t.min_count),
      max_count: t.open ? null : Number(t.max_count),
      rate_per_activation: t.rate_per_activation,
    })),
  };
}
