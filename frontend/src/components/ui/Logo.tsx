/**
 * Logo — the Redwave brand mark. The SVG is INLINED (via svgr `?react`) so it sizes + themes through
 * tokens: the orange comes from `var(--brand-orange)` (a constant), and the "ink" (wordmark + the lower
 * wave) is `currentColor`, so it inherits each placement's text token — light on the navy sidebar (both
 * themes), near-black on the light login card, near-white on the dark one. No hard-coded colour/font.
 * `full` = wave + "Redwave marketing"; `mark` = the wave icon only (collapsed sidebar / tight spaces).
 * — design-system §3.5 / §6.6
 */
import FullLogo from '../../assets/brand/redwave-logo.svg?react';
import MarkLogo from '../../assets/brand/redwave-mark.svg?react';
import { cx } from './cx';
import styles from './Logo.module.css';

export interface LogoProps {
  /** `full` = wave + wordmark; `mark` = the wave icon only. */
  variant?: 'full' | 'mark';
  size?: 'sm' | 'md' | 'lg';
  /** Accessible name (ignored when `decorative`). */
  title?: string;
  /** Hide from the a11y tree when an adjacent label already names it (e.g. a collapsed-sidebar tooltip). */
  decorative?: boolean;
  className?: string;
}

export function Logo({
  variant = 'full',
  size = 'md',
  title = 'Redwave Marketing',
  decorative,
  className,
}: LogoProps) {
  const Svg = variant === 'mark' ? MarkLogo : FullLogo;
  return (
    <span
      className={cx(styles.logo, styles[size], className)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
    >
      <Svg className={styles.svg} aria-hidden focusable={false} />
    </span>
  );
}
