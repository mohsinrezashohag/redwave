/**
 * Sales types — RESPONSE shapes are now ALIASED to the generated OpenAPI schema (the backend ships
 * `@ApiResponse` DTOs as of Batch A #2), so the type names below are the single source of truth and stay
 * in lockstep with `backend/src/modules/sales/dto/sale.response.ts`. REQUEST bodies are likewise typed from
 * the generated schema. `Client`/`Product`/`Rep` stay hand-written minimal shapes — their owning modules
 * (Clients/HRM) aren't annotated yet; re-point them when those chunks land. — CLAUDE §13
 */
import type { components } from '../../api/generated/schema';

// Enums derived from the contract (dashboards imports `ProductType` from here — keep it exported).
export type SaleStatus = components['schemas']['SaleResponse']['status'];
export type ProductType = components['schemas']['SaleItemResponse']['product_type'];

// Frozen-snapshot fields (`rate_applied`/`commission_paid`/`incentive_amount`, nullable until paid — #2)
// are carried by SaleItemResponse; the clawback feature reads them off this type.
export type SaleItem = components['schemas']['SaleItemResponse'];

/** The 4-field pay period DERIVED onto a sale by list/findOne (≠ Pay Run's fuller PayPeriod). */
export type PayPeriod = components['schemas']['SalePayPeriodResponse'];

export type Sale = components['schemas']['SaleResponse'];

/** The paginated list envelope ({ data, meta }) the server now returns for GET /v1/sales (arch §5.1). */
export type SalePage = components['schemas']['SalePageResponse'];

export type BulkValidateResult = components['schemas']['BulkValidateResultResponse'];

export type DeletedSale = components['schemas']['DeletedSaleResponse'];

export interface Client {
  id: string;
  client_code: string;
  name: string;
  market: string;
  supplies_mpu_id: boolean;
  is_active: boolean;
}

/** The paginated /v1/clients envelope — unwrapped to a plain array for the entry/filter dropdowns. */
export type ClientPage = components['schemas']['ClientPageResponse'];

export interface Product {
  id: string;
  client_id: string;
  name: string;
  product_type: ProductType;
  is_active: boolean;
}

/** Minimal rep shape for the on-behalf selector + rep filter (the full rep record lives in HRM). */
export interface Rep {
  id: string;
  rep_code: string;
  full_name: string;
  status: string;
}

export interface SalesFilters {
  status?: SaleStatus;
  rep_id?: string;
  client_id?: string;
  date_from?: string;
  date_to?: string;
  /** Free-text search across sale_code + customer_name (server-side). */
  search?: string;
}

/** Server-side list params: the filters plus pagination/sort (page is 1-based). */
export interface SalesListParams extends SalesFilters {
  page: number;
  limit: number;
  sort?: string;
}

// Request bodies — typed from the generated schema (the backend DID emit request DTOs).
export type CreateSaleBody = components['schemas']['CreateSaleDto'];
export type ValidateSaleBody = components['schemas']['ValidateSaleDto'];
export type SetGreenfieldBody = components['schemas']['SetGreenfieldDto'];
export type BulkValidateBody = components['schemas']['BulkValidateDto'];
export type UpdateSaleBody = components['schemas']['UpdateSaleDto'];

/** The signed-in rep's own profile (only the Agent ID is read, for the sale form). */
export type OwnRepProfile = components['schemas']['MyRepProfileResponse'];

// ── Sale edit requests (client meeting 2026-11-16) ──
export type SaleEditRequest = components['schemas']['SaleEditRequestResponse'];
export type SaleEditRequestPage = components['schemas']['SaleEditRequestPageResponse'];
export type SaleEditDiff = components['schemas']['SaleEditDiffResponse'];
export type SaleEditRequestStatus = SaleEditRequest['status'];
