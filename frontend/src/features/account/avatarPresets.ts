/** The Super Admin's three built-in avatars (files in public/avatars; stored as `preset:<name>`). 2026-11-12 */
export const AVATAR_PRESETS = [
  { value: 'preset:compass', src: '/avatars/compass.svg', label: 'Compass' },
  { value: 'preset:wave', src: '/avatars/wave.svg', label: 'Wave' },
  { value: 'preset:summit', src: '/avatars/summit.svg', label: 'Summit' },
] as const;

/** Which preset the current photo URL shows (the server returns `/avatars/<name>.svg`). */
export function presetFromUrl(url: string | null | undefined): string | null {
  return AVATAR_PRESETS.find((p) => url === p.src || url?.endsWith(p.src))?.value ?? null;
}
