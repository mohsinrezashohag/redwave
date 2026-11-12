/**
 * Modal / dialog — design-system §6.5. Radix Dialog (traps focus, Esc, restores focus) styled with
 * tokens. Focused tasks + all confirmations. Destructive confirms should restate the consequence in
 * the body. Tokens only.
 *
 * `dirty` (or `useModalDirty` from a form inside): closing with unsaved edits asks to discard first. A
 * Cancel button should be wrapped in `<ModalClose asChild>` so it goes through the same check; closing
 * after a successful save (the parent's own onClose) is never interrupted. — 2026-11-12
 */
import * as RDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { ModalDirtyContext } from './modalDirty';
import { cx } from './cx';
import { IconButton } from './IconButton';
import styles from './Modal.module.css';

export interface ModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** `xl` = a viewer (file preview): wide, for content rather than a form. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Has unsaved edits: closing asks "Discard unsaved changes?" first. */
  dirty?: boolean;
}

export function Modal({ open, onOpenChange, trigger, title, description, children, footer, size = 'md', dirty = false }: ModalProps) {
  const [childDirty, setChildDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const report = useCallback((d: boolean) => setChildDirty(d), []);
  const hasEdits = dirty || childDirty;
  // A fresh open never inherits the last session's "dirty".
  useEffect(() => {
    if (!open) {
      setChildDirty(false);
      setConfirmDiscard(false);
    }
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (!next && hasEdits) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange?.(next);
  };

  return (
    <RDialog.Root open={open} onOpenChange={handleOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className={styles.overlay} />
        <RDialog.Content className={cx(styles.content, styles[size])}>
          <div className={styles.header}>
            <RDialog.Title className={styles.title}>{title}</RDialog.Title>
            <RDialog.Close asChild>
              <IconButton label="Close" icon={<X size={18} />} />
            </RDialog.Close>
          </div>
          {description && <RDialog.Description className={styles.description}>{description}</RDialog.Description>}
          <ModalDirtyContext.Provider value={report}>
            {children && <div className={styles.body}>{children}</div>}
            {footer && <div className={styles.footer}>{footer}</div>}
          </ModalDirtyContext.Provider>
        </RDialog.Content>
      </RDialog.Portal>
      {confirmDiscard && (
        <Modal
          open
          onOpenChange={(o) => !o && setConfirmDiscard(false)}
          title="Discard unsaved changes?"
          description="You have changes that haven’t been saved. If you close now, they will be lost."
          size="sm"
          footer={
            <>
              <Button variant="secondary" type="button" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
              <Button
                variant="destructive"
                type="button"
                onClick={() => {
                  setConfirmDiscard(false);
                  setChildDirty(false);
                  onOpenChange?.(false);
                }}
              >
                Discard
              </Button>
            </>
          }
        />
      )}
    </RDialog.Root>
  );
}

export const ModalClose = RDialog.Close;
