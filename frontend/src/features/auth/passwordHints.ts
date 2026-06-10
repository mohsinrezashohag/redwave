/** Shared password-strength hint + a client-side mirror of the server policy (the server is the real gate). */
export const PASSWORD_HINT = 'At least 8 characters, with an uppercase letter, a lowercase letter, and a number.';

export function passwordIssues(pw: string): string[] {
  const unmet: string[] = [];
  if (pw.length < 8) unmet.push('be at least 8 characters');
  if (!/[A-Z]/.test(pw)) unmet.push('include an uppercase letter');
  if (!/[a-z]/.test(pw)) unmet.push('include a lowercase letter');
  if (!/[0-9]/.test(pw)) unmet.push('include a number');
  return unmet;
}
