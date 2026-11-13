/**
 * Commission Config types (the REP-commission stream — SEPARATE from client billing rates, CLAUDE #3).
 * RESPONSE shapes ALIASED to the generated OpenAPI schema (the backend ships `@ApiResponse` DTOs as of
 * Batch A #2). Mirrors `backend/src/modules/commission/dto/commission.response.ts`. Money/rates are decimal
 * STRINGS (#1). This feature's RATE reads are ONLY /v1/commission/* + /v1/incentives — never
 * client_billing_rates. (The incentive scope picker reads /v1/clients as a client REFERENCE only.)
 */
import type { components } from '../../api/generated/schema';

// Enums derived from the contract.
export type ProductType = components['schemas']['FlatRateResponse']['product_type'];
export type IncentiveTargetType = components['schemas']['IncentiveResponse']['target_type'];
export type IncentiveStatus = components['schemas']['IncentiveResponse']['status'];

// ── Effective-dated config + incentives (response shapes) ──────────────────────────
export type FlatRate = components['schemas']['FlatRateResponse'];
export type Incentive = components['schemas']['IncentiveResponse'];

// ── Request bodies ───────────────────────────────────────────────────────────────
export type CreateFlatRateBody = components['schemas']['CreateFlatRateDto'];
export type UpdateFlatRateBody = components['schemas']['UpdateFlatRateDto'];
export type CreateIncentiveBody = components['schemas']['CreateIncentiveDto'];
export type UpdateIncentiveBody = components['schemas']['UpdateIncentiveDto'];
