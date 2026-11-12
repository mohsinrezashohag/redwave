/**
 * useConfirm — ask before a destructive one-click action (2026-11-12). Several menu actions (deactivate a
 * product, force a user out, end an incentive) used to fire immediately; this wraps them in the standard
 * ConfirmDialog without each table carrying its own open/target state.
 *
 *   const { confirm, dialog } = useConfirm();
 *   onSelect: () => confirm({ title: 'Deactivate this product?', confirmLabel: 'Deactivate', onConfirm: () => … })
 *   …render {dialog} once.
 */
import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

export interface ConfirmRequest {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  /** Danger styling (default true). */
  destructive?: boolean;
  onConfirm: () => void;
}

export function useConfirm(): { confirm: (req: ConfirmRequest) => void; dialog: ReactNode } {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const dialog = (
    <ConfirmDialog
      open={req !== null}
      onOpenChange={(o) => !o && setReq(null)}
      title={req?.title ?? ''}
      description={req?.description}
      confirmLabel={req?.confirmLabel}
      destructive={req?.destructive ?? true}
      onConfirm={() => {
        const run = req?.onConfirm;
        setReq(null);
        run?.();
      }}
    />
  );
  return { confirm: setReq, dialog };
}
