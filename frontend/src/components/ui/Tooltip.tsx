/**
 * Tooltip — design-system §6.5/§9. Radix Tooltip styled with tokens; for icon-button labels, truncated
 * text, and definitions. Requires a TooltipProvider near the app root.
 */
import * as RTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import styles from './Tooltip.module.css';

export const TooltipProvider = RTooltip.Provider;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className={styles.content} side={side} sideOffset={6}>
          {content}
          <RTooltip.Arrow className={styles.arrow} />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
