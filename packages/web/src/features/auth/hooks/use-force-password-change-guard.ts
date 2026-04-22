/**
 * useForcePasswordChangeGuard — watches the current user's force_password_change flag.
 *
 * If the flag is true and the user is not already on the reset-password route,
 * navigates them to /_unauth/reset-password/<token>.
 *
 * Task 1e.91
 */
import { useEffect } from 'react';
import { useNavigate, useLocation } from '@tanstack/react-router';
import { useMockStore } from '@/api/mock-store';
import { generateForcePasswordToken } from '../api';

export function useForcePasswordChangeGuard(): void {
  const navigate = useNavigate();
  const location = useLocation();

  const currentUserId = useMockStore((s) => s.currentUserId);
  const users = useMockStore((s) => s.users);

  const currentUser = currentUserId ? users[currentUserId] : null;
  const forcePasswordChange = currentUser?.force_password_change ?? false;

  useEffect(() => {
    if (!currentUserId || !forcePasswordChange) return;

    // Don't redirect if already on the reset-password route to avoid loops.
    if (location.pathname.startsWith('/reset-password/')) return;

    const token = generateForcePasswordToken(currentUserId);
    void navigate({ to: '/reset-password/$token', params: { token } });
  }, [currentUserId, forcePasswordChange, location.pathname, navigate]);
}
