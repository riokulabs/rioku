/**
 * /t/$tenant/cluster/enrollment-tokens — manage cluster enrollment tokens.
 *
 * Permission inherited from cluster.tsx (cluster:read). Generate / revoke
 * gated client-side by cluster:enroll; daemon enforces cluster:enroll on
 * the matching webhook routes.
 */
import { createFileRoute } from '@tanstack/react-router';
import { EnrollmentTokensPage } from '@/features/cluster/components/enrollment-tokens-page';

export const Route = createFileRoute('/t/$tenant/cluster/enrollment-tokens')({
  component: EnrollmentTokensPage,
});
