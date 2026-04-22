/**
 * Shared helpers + atomic components for the API-management feature cluster.
 *
 * Components here are cross-used by Services, Routes, Policies, Middlewares,
 * and Sites. Keep this barrel tight — no feature-specific logic leaks in.
 */
export { ProtocolBadge } from './protocol-badge';
export { HealthChip } from './health-chip';
export { TagsInput } from './tags-input';
export type { TagsInputProps } from './tags-input';
export { formatUpstreamUrl, buildMatchPreview, isDestructiveMiddleware } from './helpers';
