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
/** Flat rates exclude internet (it's tiered) — a UI/form constraint, narrower than the response enum. */
export type FlatProductType = 'greenfield_internet' | 'tv' | 'home_phone';
export type IncentiveTargetType = components['schemas']['IncentiveResponse']['target_type'];
export type IncentiveStatus = components['schemas']['IncentiveResponse']['status'];

// ── Effective-dated config + incentives (response shapes) ──────────────────────────
export type TierBracket = components['schemas']['TierBracketResponse'];
export type TierConfig = components['schemas']['TierConfigResponse'];
export type FlatRate = components['schemas']['FlatRateResponse'];
export type HoldbackConfig = components['schemas']['HoldbackConfigResponse'];
export type HoldbackReleaseSetting = components['schemas']['HoldbackReleaseSettingResponse'];
export type Incentive = components['schemas']['IncentiveResponse'];

// ── Request bodies ───────────────────────────────────────────────────────────────
// The max_count swagger quirk is fixed (Batch A #2), so the generated tier DTO is now usable directly.
export type CreateTierScheduleBody = components['schemas']['CreateTierScheduleDto'];
export type CreateFlatRateBody = components['schemas']['CreateFlatRateDto'];
export type SetHoldbackConfigBody = components['schemas']['SetHoldbackConfigDto'];
export type SetHoldbackReleaseBody = components['schemas']['SetHoldbackReleaseSettingDto'];
export type CreateIncentiveBody = components['schemas']['CreateIncentiveDto'];
export type UpdateIncentiveBody = components['schemas']['UpdateIncentiveDto'];
