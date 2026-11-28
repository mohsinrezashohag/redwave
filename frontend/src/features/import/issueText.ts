/**
 * Split a standard import issue ("Rep: "Abdul Malak" was not found…") into its column and the rest. Pure.
 * Only a short leading label counts as a column, so a sentence that merely contains a colon later on (a
 * time, a list) is never cut. 2026-11-28
 */
export function splitIssue(text: string): { column: string | null; message: string } {
  const m = /^([A-Z][A-Za-z ]{0,24}): (.+)$/s.exec(text.trim());
  return m ? { column: m[1], message: m[2] } : { column: null, message: text };
}
