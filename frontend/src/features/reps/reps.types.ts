/**
 * Rep types — RESPONSE shapes ALIASED to the generated OpenAPI schema. PII (payment_details, DOB, contact,
 * address, the masked SIN) is NULLED server-side unless the caller has hrm:edit. The SIN itself is never in
 * a rep response — only `sin_on_file` + `sin_masked`; the full value comes from the audited reveal endpoint.
 * The list is server-paginated ({ data, meta }).
 */
import type { components } from '../../api/generated/schema';

export type Rep = components['schemas']['RepResponse'];
export type RepStatus = Rep['status'];

/** The paginated /v1/reps envelope ({ data, meta }). */
export type RepPage = components['schemas']['RepPageResponse'];

export type CreateRepBody = components['schemas']['CreateRepDto'];
export type UpdateRepBody = components['schemas']['UpdateRepDto'];
export type RevealSin = components['schemas']['RevealSinResponse'];
/** The signed-in rep's own profile (GET /v1/account/rep-profile) — adds their field manager's name. */
export type MyRepProfile = components['schemas']['MyRepProfileResponse'];

export type RepEquipment = components['schemas']['RepEquipmentResponse'];
export type EquipmentStatus = RepEquipment['status'];
export type CreateEquipmentBody = components['schemas']['CreateRepEquipmentDto'];
export type UpdateEquipmentBody = components['schemas']['UpdateRepEquipmentDto'];

export type RepDocument = components['schemas']['RepDocumentResponse'];

/** Server sort allowlist (mirrors reps.service findAll): rep_code/full_name/status/hire_date/created_at. */
export type RepSortKey = 'rep_code' | 'full_name' | 'status' | 'hire_date' | 'created_at';

/** UI status filter — adds 'all' over the two real statuses. */
export type RepStatusFilter = 'active' | 'terminated' | 'all';

export interface RepsFilters {
  status?: RepStatusFilter;
  fieldManagerId?: string;
  search?: string;
}

/** Server-side list params: filters + pagination/sort (page is 1-based). */
export interface RepsListParams extends RepsFilters {
  page: number;
  limit: number;
  sort?: string;
}
