/**
 * renderTemplate — pure substitution of `{var}` placeholders from a values map. Used by the notification
 * emitter so the Super-Admin-edited title/body templates are filled at send time. A null/empty template
 * falls back to the call-site text; an unknown `{token}` is left intact (so authors notice). No deps → unit-tested.
 */
export function renderTemplate(
  template: string | null | undefined,
  vars: Record<string, string> | undefined,
  fallback: string,
): string {
  if (!template) return fallback;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars?.[key] ?? match);
}
