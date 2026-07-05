/**
 * KM-rate config types — RESPONSE aliased to the generated OpenAPI schema. Per-client, effective-dated
 * kilometre rate (Meeting 3, EXP-004). Two-stream (#3): rep (reimbursement) / client_bill. — SRS §11
 */
import type { components } from '../../api/generated/schema';

export type KmRate = components['schemas']['KmRateResponse'];
export type KmRateStream = KmRate['stream'];
export type CreateKmRateBody = components['schemas']['CreateKmRateDto'];
