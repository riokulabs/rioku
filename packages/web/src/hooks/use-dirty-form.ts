/**
 * useDirtyForm — TanStack Router navigation blocker for dirty Mantine forms.
 *
 * When the form has unsaved changes (`form.isDirty()` returns true), the hook:
 *   1. Intercepts in-app navigation via TanStack Router's `useBlocker`.
 *   2. Opens a Mantine confirm modal offering "Discard" (proceed) or
 *      "Stay on this page" (cancel).
 *   3. Registers a `beforeunload` listener for tab-close / hard navigation.
 *
 * NOTE — "Save" option omitted at stage 1.
 * A "Save" button in the modal would require the hook to know the form's
 * submit handler and whether submission succeeds before proceeding. That
 * coupling is caller-specific and not expressible in a generic hook. Callers
 * who need a Save shortcut should open the modal themselves. This is
 * documented as a known stage-1 limitation.
 */

import { useEffect, useRef } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { modals } from '@mantine/modals';
import type { UseFormReturnType } from '@mantine/form';

export interface UseDirtyFormReturn {
  isDirty: boolean;
}

export function useDirtyForm<T>(form: UseFormReturnType<T>): UseDirtyFormReturn {
  const isDirty = form.isDirty();

  // Track whether TanStack Router's blocker has already opened the modal so
  // the beforeunload handler does not fire a redundant browser dialog.
  const blockerActiveRef = useRef(false);

  // --- TanStack Router in-app navigation blocker ---
  const blocker = useBlocker({
    shouldBlockFn: () => form.isDirty(),
    // Disable the built-in beforeunload integration — we manage it ourselves
    // to coordinate with our own beforeunload listener.
    enableBeforeUnload: false,
    withResolver: true,
  });

  // Capture proceed/reset so the modal callbacks close over stable references.
  const { proceed, reset } = blocker.status === 'blocked'
    ? blocker
    : { proceed: undefined, reset: undefined };

  // Open the confirm modal whenever the blocker transitions to "blocked".
  useEffect(() => {
    if (blocker.status !== 'blocked') return;

    blockerActiveRef.current = true;

    modals.openConfirmModal({
      title: 'You have unsaved changes',
      children: 'Leaving this page will discard your changes. This cannot be undone.',
      labels: { confirm: 'Discard changes', cancel: 'Stay on this page' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        blockerActiveRef.current = false;
        proceed?.();
      },
      onCancel: () => {
        blockerActiveRef.current = false;
        reset?.();
      },
    });
  }, [blocker.status, proceed, reset]);

  // --- beforeunload for tab-close / hard navigation ---
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      // If the router blocker is already handling this navigation do not
      // add a second prompt.
      if (blockerActiveRef.current) return;
      if (!form.isDirty()) return;

      event.preventDefault();
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { isDirty };
}
