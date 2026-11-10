/**
 * Export-layout types — ALIASED to the generated schema (§13.2).
 *
 * The field registry is the SERVER's, and it is where #3 is enforced: a payroll layout has no client-rate
 * field to reference and a statement has no rep-pay field. The UI picker simply cannot offer what is not
 * in the registry.
 */
import type { components } from '../../api/generated/schema';

export type ExportLayout = components['schemas']['ExportLayoutResponse'];
export type ExportLayoutColumn = components['schemas']['ExportLayoutColumnResponse'];
export type ExportRegistryEntry = components['schemas']['ExportRegistryEntryResponse'];
export type SaveExportLayoutBody = components['schemas']['SaveExportLayoutDto'];
