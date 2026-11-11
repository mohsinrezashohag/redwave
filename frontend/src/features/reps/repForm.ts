/**
 * Rep form — the zod schema + the form → API body mapping for Add / Edit rep. Pure (no React).
 *
 * The checks MIRROR the server's (hrm/rep-profile.logic + RepsService) so a rep sees the problem inline as
 * they type; the server re-validates everything and is the real gate (422).
 *   - SIN: 9 digits + Luhn. Blank = "no change" on edit (it is write-only — the form never holds the stored
 *     SIN), "none" on create.
 *   - Postal code: Canadian (A1A 1A1). DOB: not in the future (today is passed in, so this stays pure).
 *   - Empty optional text → null (clears the field on edit).
 */
import { z } from 'zod';
import type { CreateRepBody, Rep, UpdateRepBody } from './reps.types';

export const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] as const;
export const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;
/** Radix Select forbids an empty value — the "not set" sentinel (§13.2). */
export const NONE = '__none__';

/** Luhn check for a 9-digit SIN (spaces/dashes allowed). Mirrors the server's normalizeSin. */
export function isValidSin(input: string): boolean {
  const digits = input.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const POSTAL = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

export function repFormSchema(mode: 'create' | 'edit', today: string) {
  return z
    .object({
      rep_code: z.string().max(50),
      full_name: z.string().trim().min(1, 'Required').max(150),
      external_code: z.string().max(50),
      field_manager_id: z.string().min(1, 'Pick a field manager'),
      hire_date: z.string().min(1, 'Required'),
      status: z.enum(['active', 'terminated']),
      termination_date: z.string(),
      date_of_birth: z.string().refine((v) => !v || v <= today, 'Date of birth can’t be in the future'),
      phone: z.string().refine((v) => !v || /^[+\d\s().-]{7,30}$/.test(v), 'Enter a valid phone number'),
      email: z.string().refine((v) => !v || z.string().email().safeParse(v).success, 'Enter a valid email'),
      address_street: z.string().max(200),
      address_city: z.string().max(100),
      address_province: z.string(),
      address_postal: z.string().refine((v) => !v || POSTAL.test(v.trim()), 'Use a Canadian postal code, e.g. R3G 0T7'),
      sin: z
        .string()
        .refine((v) => !v.trim() || /^\d{9}$/.test(v.replace(/[\s-]/g, '')), 'A SIN has exactly 9 digits. Spaces or dashes are fine.')
        .refine(
          (v) => !v.trim() || !/^\d{9}$/.test(v.replace(/[\s-]/g, '')) || isValidSin(v),
          'This isn’t a real SIN. Every SIN has a built-in check digit, and this one doesn’t match. Check the card for a typo.',
        ),
      jacket_size: z.string(),
      tshirt_size: z.string(),
    })
    .superRefine((v, ctx) => {
      if (mode === 'create' && !v.rep_code.trim()) {
        ctx.addIssue({ code: 'custom', path: ['rep_code'], message: 'Required — permanent, never reused' });
      }
      if (v.status === 'terminated' && !v.termination_date) {
        ctx.addIssue({ code: 'custom', path: ['termination_date'], message: 'Required when terminating' });
      }
    });
}

export type RepFormValues = z.infer<ReturnType<typeof repFormSchema>>;

/** The form's starting values — blank for create, the rep's (redacted-as-served) values for edit. */
export function repFormDefaults(rep: Rep | null): RepFormValues {
  const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');
  return {
    rep_code: rep?.rep_code ?? '',
    full_name: rep?.full_name ?? '',
    external_code: rep?.external_code ?? '',
    field_manager_id: rep?.field_manager_id ?? '',
    hire_date: day(rep?.hire_date),
    status: rep?.status ?? 'active',
    termination_date: day(rep?.termination_date),
    date_of_birth: day(rep?.date_of_birth),
    phone: rep?.phone ?? '',
    email: rep?.email ?? '',
    address_street: rep?.address_street ?? '',
    address_city: rep?.address_city ?? '',
    address_province: rep?.address_province ?? NONE,
    address_postal: rep?.address_postal ?? '',
    sin: '', // write-only: never pre-filled
    jacket_size: rep?.jacket_size ?? NONE,
    tshirt_size: rep?.tshirt_size ?? NONE,
  };
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);
const pick = (v: string) => (v === NONE || !v ? null : v);

/** The profile part of the body, shared by create and edit. A blank SIN is OMITTED (= keep / none). */
function profileBody(v: RepFormValues) {
  return {
    date_of_birth: v.date_of_birth || null,
    phone: orNull(v.phone),
    email: orNull(v.email),
    address_street: orNull(v.address_street),
    address_city: orNull(v.address_city),
    address_province: pick(v.address_province),
    address_postal: orNull(v.address_postal),
    jacket_size: pick(v.jacket_size),
    tshirt_size: pick(v.tshirt_size),
    ...(v.sin.trim() ? { sin: v.sin.trim() } : {}),
  };
}

export function toCreateBody(v: RepFormValues): CreateRepBody {
  return {
    rep_code: v.rep_code.trim(),
    full_name: v.full_name.trim(),
    field_manager_id: v.field_manager_id,
    hire_date: v.hire_date,
    ...(v.external_code.trim() ? { external_code: v.external_code.trim() } : {}),
    ...profileBody(v),
  } as CreateRepBody;
}

export function toUpdateBody(v: RepFormValues): UpdateRepBody {
  return {
    full_name: v.full_name.trim(),
    external_code: v.external_code.trim(),
    field_manager_id: v.field_manager_id,
    hire_date: v.hire_date,
    status: v.status,
    ...(v.status === 'terminated' ? { termination_date: v.termination_date } : {}),
    ...profileBody(v),
  } as UpdateRepBody;
}
