/**
 * PersonName — a person as shown in lists: small photo + name (2026-11-12). The photo is a short-lived URL
 * from the API (a rep's = their HR headshot); without one, initials. Use it wherever a rep or user is
 * listed so people look the same everywhere. Tokens only.
 */
import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import { cx } from './cx';
import styles from './PersonName.module.css';

export interface PersonNameProps {
  name: string;
  photoUrl?: string | null;
  /** Optional extra line (a code, an email). */
  detail?: ReactNode;
  /** Wrap the name (e.g. in a Link). */
  renderName?: (name: string) => ReactNode;
  className?: string;
}

export function PersonName({ name, photoUrl, detail, renderName, className }: PersonNameProps) {
  return (
    <span className={cx(styles.person, className)}>
      <Avatar name={name} src={photoUrl} size="sm" />
      <span className={styles.text}>
        <span className={styles.name}>{renderName ? renderName(name) : name}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </span>
    </span>
  );
}
