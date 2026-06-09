/**
 * Reporting response DTOs — the four role-scoped dashboards, the counts-only leaderboard, notifications,
 * and the chatbot answer. — Batch A #2
 *
 * Money is READ from frozen/computed rows and reported as decimal STRINGS (#1/#5) — never recomputed.
 * The leaderboard carries NO money field (counts only). Nothing here exposes another rep's earnings.
 */
import { ApiProperty } from '@nestjs/swagger';
import { ClawbackStatus, NotificationChannel } from '@prisma/client';

const CHAT_INTENTS = [
  'my_sales_count',
  'my_commission',
  'my_holdback',
  'roster_summary',
  'business_summary',
  'unknown',
] as const;
type ChatIntent = (typeof CHAT_INTENTS)[number];

/** The minimal period stamp on a dashboard (null when no period is in scope). */
export class DashPeriodResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 3 })
  period_number!: number;
}

export class ProductCountResponse {
  @ApiProperty({ type: String, example: 'internet', description: 'Product-type catalogue key.' })
  product_type!: string;

  @ApiProperty()
  count!: number;
}

export class RepTierResponse {
  @ApiProperty()
  tier_number!: number;

  @ApiProperty()
  count!: number;

  @ApiProperty({ type: Number, nullable: true })
  next_tier_min!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  to_next!: number | null;
}

export class RepCommissionResponse {
  @ApiProperty({ type: String, example: '2317.00', description: 'Decimal string.' })
  commission_70!: string;

  @ApiProperty({ type: String, example: '993.00', description: 'Decimal string.' })
  holdback_release_30!: string;

  @ApiProperty({ type: String, example: '0.00', description: 'Decimal string.' })
  incentive_total!: string;

  @ApiProperty({ type: String, example: '2317.00', description: 'Decimal string.' })
  net_payout!: string;
}

export class RepClawbackResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, example: '145.00', description: 'Decimal string.' })
  amount!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ enum: ClawbackStatus })
  status!: ClawbackStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}

export class RepDashboardResponse {
  @ApiProperty({ type: () => DashPeriodResponse, nullable: true })
  period!: DashPeriodResponse | null;

  @ApiProperty({ type: () => [ProductCountResponse] })
  counts_by_product!: ProductCountResponse[];

  @ApiProperty()
  internet_activations!: number;

  @ApiProperty({ type: () => RepTierResponse, nullable: true })
  tier!: RepTierResponse | null;

  @ApiProperty({ type: () => RepCommissionResponse })
  commission!: RepCommissionResponse;

  @ApiProperty({ type: String, example: '0.00', description: 'Decimal string — held, awaiting release.' })
  holdback_pending_release!: string;

  @ApiProperty({ type: () => [RepClawbackResponse] })
  recent_clawbacks!: RepClawbackResponse[];
}

export class ManagerDashboardResponse {
  @ApiProperty({ type: () => DashPeriodResponse, nullable: true })
  period!: DashPeriodResponse | null;

  @ApiProperty({ type: Number, nullable: true })
  roster_size!: number | null;

  @ApiProperty()
  team_internet_activations!: number;

  @ApiProperty()
  pending_validations!: number;

  @ApiProperty()
  pending_expense_approvals!: number;

  @ApiProperty()
  sales_in_period!: number;
}

// BusinessDashboardResponse moved to ./business-dashboard.response.ts (rich, period-aware KPI set).

export class AdminDashboardResponse {
  @ApiProperty()
  pending_validations!: number;

  @ApiProperty()
  pending_expense_approvals!: number;

  @ApiProperty()
  pending_profile_changes!: number;

  @ApiProperty()
  pending_signature_requests!: number;

  @ApiProperty()
  draft_pay_runs!: number;
}

export class LeaderboardRowResponse {
  @ApiProperty()
  rank!: number;

  @ApiProperty()
  rep_id!: string;

  @ApiProperty({ type: String, nullable: true })
  rep_code!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rep_name!: string | null;

  @ApiProperty({ description: 'Internet activation count — the ONLY metric (no earnings).' })
  activation_count!: number;
}

export class LeaderboardResponse {
  @ApiProperty({ type: () => DashPeriodResponse, nullable: true })
  period!: DashPeriodResponse | null;

  @ApiProperty({ type: () => [LeaderboardRowResponse] })
  rankings!: LeaderboardRowResponse[];
}

export class AppNotificationResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  user_id!: string;

  @ApiProperty({ example: 'rate_change' })
  type!: string;

  @ApiProperty({ enum: NotificationChannel })
  channel!: NotificationChannel;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ type: String, nullable: true })
  related_entity_type!: string | null;

  @ApiProperty({ type: String, nullable: true })
  related_entity_id!: string | null;

  @ApiProperty()
  is_read!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sent_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at!: string;
}

export class NotificationSettingResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'rate_change' })
  event_type!: string;

  @ApiProperty()
  in_app_enabled!: boolean;

  @ApiProperty()
  email_enabled!: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'Rate change' })
  label!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Title template with {var} placeholders.' })
  title_template!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Body template with {var} placeholders.' })
  body_template!: string | null;

  @ApiProperty()
  updated_by!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at!: string;
}

export class ChatResponse {
  @ApiProperty()
  conversation_id!: string;

  @ApiProperty({ enum: CHAT_INTENTS, description: 'The recognised intent (or "unknown").' })
  intent!: ChatIntent;

  @ApiProperty({ description: 'The server-formatted text answer (or a refusal).' })
  answer!: string;
}
