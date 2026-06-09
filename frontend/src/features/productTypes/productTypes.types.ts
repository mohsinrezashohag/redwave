/**
 * Product-type catalogue types — RESPONSE aliased to the generated OpenAPI schema. The catalogue is the
 * configurable list of product types + their LOCKED commission behaviour (tiered/greenfield/standard_addon).
 * New SA types are always standard_addon. — §6
 */
import type { components } from '../../api/generated/schema';

export type ProductType = components['schemas']['ProductTypeResponse'];
export type ProductTypeBehaviour = ProductType['behaviour'];

export type CreateProductTypeBody = components['schemas']['CreateProductTypeDto'];
export type UpdateProductTypeBody = components['schemas']['UpdateProductTypeDto'];
