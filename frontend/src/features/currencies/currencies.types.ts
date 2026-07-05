/**
 * Currency catalogue types — RESPONSE aliased to the generated OpenAPI schema. The allowed billing/expense
 * currencies (CAD/USD + admin-extensible). — Meeting 3, CLAUDE §3 #12
 */
import type { components } from '../../api/generated/schema';

export type Currency = components['schemas']['CurrencyResponse'];
