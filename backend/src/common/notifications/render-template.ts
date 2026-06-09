/**
 * renderTemplate — pure substitution of `{var}` placeholders from a values map. Used by the notification
 * emitter so the Super-Admin-edited title/body templates are filled at send time. A null/empty template,
 * OR a template referencing any `{token}` the event didn't supply, falls back to the complete call-site
 * text — so a notification NEVER shows a raw `{placeholder}`. No deps → unit-tested.
 */
export function renderTemplate(
  template: string | null | undefined,
  vars: Record<string, string> | undefined,
  fallback: string,
): string {
  if (!template) return fallback;
  let missing = false;
  const rendered = template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (vars && Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
    missing = true;
    return '';
  });
  return missing ? fallback : rendered;
}
