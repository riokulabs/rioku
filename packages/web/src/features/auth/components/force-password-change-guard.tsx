/**
 * <ForcePasswordChangeGuard> — zero-rendering component that wires the
 * useForcePasswordChangeGuard hook into the component tree.
 *
 * Mount near the root of the app (inside RouterProvider so useNavigate is available).
 *
 * Task 1e.91
 */
import { useForcePasswordChangeGuard } from '../hooks/use-force-password-change-guard';

export function ForcePasswordChangeGuard() {
  useForcePasswordChangeGuard();
  return null;
}
