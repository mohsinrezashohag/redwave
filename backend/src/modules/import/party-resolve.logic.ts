/**
 * Who a row is FOR (client) and BY (rep), when the file doesn't carry our codes — PURE (no I/O).
 *
 * A sales-tracking app export (the NLF "sold report", 2026-11-28) names the rep as a person ("adnansaquib",
 * "Rahman Shifat") and the client as a workspace ("Northern Lights Fiber - Redwave"). Codes still win; these
 * are the fallbacks, and they only ever accept an UNAMBIGUOUS match. A rep matched on a guess would be paid
 * for someone else's sale (#5), so anything less than one clear candidate is reported, never picked.
 */

/** Lowercase, accents and punctuation stripped, words kept. */
function words(value: string | null | undefined): string[] {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

const squash = (value: string | null | undefined): string => words(value).join('');

export interface ClientRef {
  client_code: string;
  name: string;
}

/**
 * The client a cell names: its code; else its exact name; else the ONE client whose name the cell starts with
 * ("Northern Lights Fiber - Redwave" → Northern Lights Fiber). Null when none or several qualify.
 */
export function resolveClientRef(cell: string | null | undefined, clients: ClientRef[]): string | null {
  const text = (cell ?? '').trim();
  if (!text) return null;
  const byCode = clients.find((c) => c.client_code.toUpperCase() === text.toUpperCase());
  if (byCode) return byCode.client_code;
  const s = squash(text);
  const exact = clients.filter((c) => squash(c.name) === s);
  if (exact.length === 1) return exact[0].client_code;
  const prefix = clients.filter((c) => squash(c.name).length >= 3 && s.startsWith(squash(c.name)));
  return prefix.length === 1 ? prefix[0].client_code : null;
}

export interface RepRef {
  rep_code: string;
  external_code: string | null;
  full_name: string;
}

export type RepResolution =
  | { kind: 'code'; rep_code: string }
  | { kind: 'name'; rep_code: string; full_name: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'none' };

/**
 * The rep a cell names. By rep code or partner code first. Otherwise by name, accepted only when exactly one
 * active rep matches:
 *  - the whole name, ignoring spaces and case ("adnansaquib" = "Adnan Saquib"); else
 *  - every word of a two-word-or-longer cell appears in the rep's name ("Rahman Shifat" = "Md Shahidur Rahman
 *    Shifat").
 */
export function resolveRepRef(cell: string | null | undefined, reps: RepRef[]): RepResolution {
  const text = (cell ?? '').trim();
  if (!text) return { kind: 'none' };
  const code = text.toUpperCase();
  const byCode = reps.find((r) => r.rep_code.toUpperCase() === code || (r.external_code ?? '').toUpperCase() === code);
  if (byCode) return { kind: 'code', rep_code: byCode.rep_code };

  const s = squash(text);
  const whole = reps.filter((r) => squash(r.full_name) === s);
  if (whole.length === 1) return { kind: 'name', rep_code: whole[0].rep_code, full_name: whole[0].full_name };
  if (whole.length > 1) return { kind: 'ambiguous', candidates: whole.map((r) => `${r.full_name} (${r.rep_code})`) };

  const cellWords = words(text);
  if (cellWords.length < 2) return { kind: 'none' };
  const subset = reps.filter((r) => {
    const repWords = new Set(words(r.full_name));
    return cellWords.every((w) => repWords.has(w));
  });
  if (subset.length === 1) return { kind: 'name', rep_code: subset[0].rep_code, full_name: subset[0].full_name };
  if (subset.length > 1) return { kind: 'ambiguous', candidates: subset.map((r) => `${r.full_name} (${r.rep_code})`) };
  return { kind: 'none' };
}
