/**
 * Data accuracy (2026-11-13) — turns GET /v1/reps/{id}/data-accuracy into the side-by-side columns the tab
 * shows: "Rep profile" first, then one column per ID. Every column carries the SAME rows in the same order so
 * the values line up across cards. Pure. The match flags are the SERVER's; nothing is compared here.
 */
import type { components } from '../../api/generated/schema';
import { docTypeLabel } from './repDocTypes';

export type DataAccuracy = components['schemas']['DataAccuracyResponse'];

export const ACCURACY_ROWS = [
  { key: 'name', label: 'Full name' },
  { key: 'date_of_birth', label: 'Date of birth' },
  { key: 'document_number', label: 'Document no.' },
  { key: 'issued_on', label: 'Issued' },
  { key: 'expires_on', label: 'Expires' },
  { key: 'address', label: 'Address' },
] as const;

export type AccuracyRowKey = (typeof ACCURACY_ROWS)[number]['key'];

export interface AccuracyValue {
  /** null = not on file for this source. */
  value: string | null;
  /** false = differs from the profile (shown outlined). null = not compared. */
  match: boolean | null;
  /** The row doesn't exist for this source (e.g. an ID has no address). */
  notApplicable?: boolean;
}

export interface AccuracyColumn {
  id: string;
  title: string;
  expired: boolean;
  cells: Record<AccuracyRowKey, AccuracyValue>;
}

const NA: AccuracyValue = { value: null, match: null, notApplicable: true };

export function accuracyColumns(data: DataAccuracy): AccuracyColumn[] {
  const profile: AccuracyColumn = {
    id: 'profile',
    title: 'Rep profile',
    expired: false,
    cells: {
      name: { value: data.profile.name, match: null },
      date_of_birth: { value: data.profile.date_of_birth, match: null },
      document_number: NA,
      issued_on: NA,
      expires_on: NA,
      address: { value: data.profile.address, match: null },
    },
  };
  const ids = data.sources.map<AccuracyColumn>((s) => ({
    id: s.document_id,
    title: docTypeLabel(s.doc_type),
    expired: s.expired,
    cells: {
      name: s.name,
      date_of_birth: s.date_of_birth,
      document_number: s.document_number,
      issued_on: s.issued_on,
      expires_on: s.expires_on,
      address: NA,
    },
  }));
  return [profile, ...ids];
}

/** The summary line above the comparison. */
export function accuracySummary(data: DataAccuracy): { tone: 'success' | 'warning' | 'info'; title: string } {
  if (data.sources.length === 0) return { tone: 'info', title: 'No ID details to compare yet' };
  if (data.differences === 0) return { tone: 'success', title: 'Everything on file matches the profile' };
  return {
    tone: 'warning',
    title: data.differences === 1 ? '1 difference to check' : `${data.differences} differences to check`,
  };
}
