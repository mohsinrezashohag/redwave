/**
 * Dashboard + leaderboard response types — ALIASED to the generated OpenAPI schema (the backend ships
 * `@ApiResponse` DTOs as of Batch A #2). Mirrors `backend/src/modules/reporting/dto/reporting.response.ts`.
 * Money fields are decimal STRINGS ("X.XX"); counts are numbers; the leaderboard carries NO money field.
 */
import type { components } from '../../api/generated/schema';

export type DashPeriod = components['schemas']['DashPeriodResponse'];

// ── Rep dashboard ──────────────────────────────────────────────────────────────────
export type ProductCount = components['schemas']['ProductCountResponse'];
export type RepTier = components['schemas']['RepTierResponse'];
export type RepCommission = components['schemas']['RepCommissionResponse'];
export type RepClawback = components['schemas']['RepClawbackResponse'];
export type RepDashboard = components['schemas']['RepDashboardResponse'];

// ── Manager dashboard ──────────────────────────────────────────────────────────────
export type ManagerDashboard = components['schemas']['ManagerDashboardResponse'];

// ── Business / Executive dashboard (Super Admin only) ───────────────────────────────
export type BusinessDashboard = components['schemas']['BusinessDashboardResponse'];

export interface BusinessFilters {
  pay_period_id?: string;
}

// ── Admin operational home ──────────────────────────────────────────────────────────
export type AdminDashboard = components['schemas']['AdminDashboardResponse'];

// ── Leaderboard (counts only — NO money field exists at the source) ─────────────────
export type LeaderboardRow = components['schemas']['LeaderboardRowResponse'];
export type Leaderboard = components['schemas']['LeaderboardResponse'];

// ── Pay periods (for the Business period selector) ──────────────────────────────────
export interface PayPeriod {
  id: string;
  period_number: number;
  start_date: string;
  end_date: string;
}
