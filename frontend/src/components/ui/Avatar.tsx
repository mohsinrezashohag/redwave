/**
 * Avatar — design-system §6 profile/identity primitive. Renders the user's avatar image when present,
 * else a coloured initials circle (first letters of the name). Used in the My Account header, the
 * profile-review queue, and (later) the user list. Tokens only.
 */
import { useState } from 'react';
import { cx } from './cx';
import styles from './Avatar.module.css';

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

/** First letters of up to two name parts (e.g. "Jane Doe" → "JD"); falls back to "?". */
function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/**
 * A photo that fails to load (an expired signed link, a deleted file) falls back to the initials instead of
 * a broken-image icon; a new `src` gets a fresh try. — 2026-11-12
 */
export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && src !== failedSrc;
  return (
    <span className={cx(styles.avatar, styles[size], className)} aria-hidden>
      {showImage ? <img className={styles.img} src={src} alt="" onError={() => setFailedSrc(src)} /> : initials(name)}
    </span>
  );
}
