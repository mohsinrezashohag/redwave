/**
 * Popover — design-system §6.5. Quick filters, column settings, etc. Radix Popover styled with tokens.
 */
import * as RPopover from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import styles from './Popover.module.css';

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Controlled open state (optional), e.g. to close the popover after a menu item is chosen. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Popover({ trigger, children, align = 'start', side = 'bottom', open, onOpenChange }: PopoverProps) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content className={styles.content} align={align} side={side} sideOffset={6}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
