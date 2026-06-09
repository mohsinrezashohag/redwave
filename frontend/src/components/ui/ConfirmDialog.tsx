/**
 * ConfirmDialog — design-system §6.5 / §7. A shared confirm built on Modal that RESTATES the consequence
 * in plain language. For irreversible / money-moving actions (finalize pay run, apply clawback, bulk
 * delete) pass `requireTyped`: the confirm button stays disabled until the user types that phrase exactly.
 * `loading` blocks double-submit. Tokens only.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { FormField } from './FormField';
import { Input } from './Input';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Plain-language restatement of what will happen. */
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Danger styling for the confirm button (default true — confirms guard destructive actions). */
  destructive?: boolean;
  /** When set, the user must type this exact phrase to enable the confirm button. */
  requireTyped?: string;
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  requireTyped,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');

  // Reset the typed phrase whenever the dialog opens/closes so it can't carry over.
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const blocked = !!requireTyped && typed.trim() !== requireTyped;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            type="button"
            loading={loading}
            disabled={blocked || loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {requireTyped && (
        <FormField label={`Type “${requireTyped}” to confirm`}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={requireTyped} autoComplete="off" />
        </FormField>
      )}
    </Modal>
  );
}
