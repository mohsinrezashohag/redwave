/**
 * avatar.logic — PURE: which stored value becomes a user's photo (client decision 2026-11-12).
 *   - A user linked to a rep → that rep's latest HR HEADSHOT (the ID-card photo). Reps don't set their own.
 *   - Anyone else → their own uploaded photo (an `avatars/…` storage path).
 *   - An old pasted http(s) link still displays (no new ones are accepted), anything else → none.
 *   - The Super Admin picks one of three built-in avatars (2026-11-12): stored as `preset:<name>`, shown from
 *     the frontend's own `/avatars/<name>.svg` (same origin as the app, nothing to sign or store).
 */

export const AVATAR_PREFIX = 'avatars/';

/** The built-in avatars the Super Admin chooses from (files in frontend/public/avatars). */
export const AVATAR_PRESETS = ['preset:compass', 'preset:wave', 'preset:summit'] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

export function isAvatarPreset(value: string | null | undefined): value is AvatarPreset {
  return !!value && (AVATAR_PRESETS as readonly string[]).includes(value);
}

/** `preset:wave` → `/avatars/wave.svg`. */
export function presetUrl(preset: AvatarPreset): string {
  return `/avatars/${preset.slice('preset:'.length)}.svg`;
}

export type AvatarSource = { kind: 'path'; path: string } | { kind: 'link'; url: string } | null;

export function avatarSource(ownAvatar: string | null | undefined, repHeadshotPath: string | null | undefined, isRep: boolean): AvatarSource {
  if (isRep) return repHeadshotPath && !repHeadshotPath.startsWith('local://') ? { kind: 'path', path: repHeadshotPath } : null;
  if (!ownAvatar) return null;
  if (ownAvatar.startsWith(AVATAR_PREFIX)) return { kind: 'path', path: ownAvatar };
  if (isAvatarPreset(ownAvatar)) return { kind: 'link', url: presetUrl(ownAvatar) };
  if (/^https?:\/\//i.test(ownAvatar)) return { kind: 'link', url: ownAvatar };
  return null;
}
