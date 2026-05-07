/**
 * useForcePasswordChangeGuard — watches the current user's
 * `forcePasswordChange` flag from `/auth/me`. If set, navigates the user to a
 * forced password-change flow so they cannot reach any tenant-scoped route
 * with stale credentials.
 *
 * Stage 2 (this plan) routes the user to `/forgot-password` so they can
 * trigger the standard reset-token email flow.
 *
 * Plan 01 — stage 2 wiring.
 */
import { useEffect } from 'react';
import { useNavigate, useLocation } from '@tanstack/react-router';
import { useCurrentUser } from '../use-current-user';

export function useForcePasswordChangeGuard(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: me } = useCurrentUser();

  const forcePasswordChange = me?.forcePasswordChange ?? false;

  useEffect(() => {
    if (!me || !forcePasswordChange) return;

    const onAllowedPath =
      location.pathname.startsWith('/reset-password') ||
      location.pathname.startsWith('/forgot-password') ||
      location.pathname.startsWith('/login');
    if (onAllowedPath) return;

    void navigate({ to: '/forgot-password', replace: true });
  }, [me, forcePasswordChange, location.pathname, navigate]);
}
