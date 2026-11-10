/**
 * Period-config types — ALIASED to the generated schema (§13.2). The two calendars are never
 * interchangeable (§14 rule 1): `pay` governs rep pay and carries a payday offset; `billing` governs
 * client billing and has none.
 */
import type { components } from '../../api/generated/schema';

export type PeriodConfig = components['schemas']['PeriodConfigResponse'];
export type PeriodKind = PeriodConfig['kind'];
export type SetPeriodConfigBody = components['schemas']['SetPeriodConfigDto'];

/** What a regeneration would do — and, in `blocked[]`, what it refuses to touch. */
export type RegenerationPlan = components['schemas']['RegenerationPlanResponse'];
export type BlockedPeriod = components['schemas']['BlockedPeriodResponse'];
export type CalendarOverlap = components['schemas']['CalendarOverlapResponse'];
