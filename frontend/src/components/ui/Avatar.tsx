/**
 * Avatar — design-system §6 profile/identity primitive. Renders the user's avatar image when present,
 * else a coloured initials circle (first letters of the name). Used in the My Account header, the
 * profile-review queue, and (later) the user list. Tokens only.
 */
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

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  return (
    <span className={cx(styles.avatar, styles[size], className)} aria-hidden>
      {src ? <img className={styles.img} src={src} alt="" /> : initials(name)}
    </span>
  );
}
