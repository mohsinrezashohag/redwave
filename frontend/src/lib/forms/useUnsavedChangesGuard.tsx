/**
 * useUnsavedChangesGuard — a full-page form with unsaved edits asks before you leave it (2026-11-12):
 * in-app navigation (a link, the sidebar, Back) shows "Leave without saving?", and closing or reloading
 * the tab shows the browser's own prompt. Call `allowLeave()` right before the redirect that follows a
 * successful save, so that one is never interrupted.
 *
 *   const leave = useUnsavedChangesGuard(formState.isDirty);
 *   onSuccess: () => { leave.allowLeave(); navigate(...) }
 *   …render {leave.dialog} once.
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ui';

export function useUnsavedChangesGuard(dirty: boolean): { dialog: ReactNode; allowLeave: () => void } {
  const allowed = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !allowed.current && currentLocation.pathname !== nextLocation.pathname,
  );
  const allowLeave = useCallback(() => {
    allowed.current = true;
  }, []);

  useEffect(() => {
    if (!dirty || allowed.current) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // required by some browsers to show the prompt
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const dialog = (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(o) => {
        if (!o && blocker.state === 'blocked') blocker.reset();
      }}
      title="Leave without saving?"
      description="You have changes that haven’t been saved. If you leave now, they will be lost."
      confirmLabel="Leave"
      cancelLabel="Stay"
      onConfirm={() => {
        if (blocker.state === 'blocked') blocker.proceed();
      }}
    />
  );
  return { dialog, allowLeave };
}
