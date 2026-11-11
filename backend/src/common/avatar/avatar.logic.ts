/**
 * avatar.logic — PURE: which stored value becomes a user's photo (client decision 2026-11-12).
 *   - A user linked to a rep → that rep's latest HR HEADSHOT (the ID-card photo). Reps don't set their own.
 *   - Anyone else → their own uploaded photo (an `avatars/…` storage path).
 *   - An old pasted http(s) link still displays (no new ones are accepted), anything else → none.
 */

export const AVATAR_PREFIX = 'avatars/';

export type AvatarSource = { kind: 'path'; path: string } | { kind: 'link'; url: string } | null;

export function avatarSource(ownAvatar: string | null | undefined, repHeadshotPath: string | null | undefined, isRep: boolean): AvatarSource {
  if (isRep) return repHeadshotPath && !repHeadshotPath.startsWith('local://') ? { kind: 'path', path: repHeadshotPath } : null;
  if (!ownAvatar) return null;
  if (ownAvatar.startsWith(AVATAR_PREFIX)) return { kind: 'path', path: ownAvatar };
  if (/^https?:\/\//i.test(ownAvatar)) return { kind: 'link', url: ownAvatar };
  return null;
}
