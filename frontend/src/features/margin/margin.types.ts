/**
 * Margin types — ALIASED to the generated schema (§13.2).
 *
 * This is the ONE place the two rate streams appear together, sanctioned by packet 07 for a read-only
 * report. Every value here is server-computed; the UI never derives a margin itself (#1).
 */
import type { components } from '../../api/generated/schema';

export type MarginRow = components['schemas']['MarginRowResponse'];
export type MarginGroup = components['schemas']['MarginGroupResponse'];
export type RateInForce = components['schemas']['RateInForceResponse'];
export type RollupDimension = 'product' | 'client' | 'rep';
