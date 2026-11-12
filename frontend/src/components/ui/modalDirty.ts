/**
 * Unsaved-changes guard for Modal (2026-11-12). A form rendered INSIDE a Modal reports whether it has
 * unsaved edits with `useModalDirty(formState.isDirty)`; a form that renders the Modal itself passes
 * `dirty` to it instead. Either way, closing (Esc, overlay, X, a Cancel wrapped in ModalClose) asks
 * "Discard unsaved changes?" first.
 */
import { createContext, useContext, useEffect } from 'react';

export const ModalDirtyContext = createContext<((dirty: boolean) => void) | null>(null);

export function useModalDirty(dirty: boolean): void {
  const report = useContext(ModalDirtyContext);
  useEffect(() => {
    report?.(dirty);
    return () => report?.(false);
  }, [dirty, report]);
}
