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
}

// Request bodies — typed from the generated schema (the backend DID emit request DTOs).
export type CreateSaleBody = components['schemas']['CreateSaleDto'];
export type ValidateSaleBody = components['schemas']['ValidateSaleDto'];
export type SetGreenfieldBody = components['schemas']['SetGreenfieldDto'];
export type BulkValidateBody = components['schemas']['BulkValidateDto'];
