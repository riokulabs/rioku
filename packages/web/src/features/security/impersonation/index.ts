/**
 * Impersonation feature — barrel exports.
 * spec §8.2 / Tasks 1d.74–1d.77
 */
export { ImpersonationEntryForm } from './components/entry-form';
export { ProfileToggle } from './components/profile-toggle';
export { ImpersonationIdleModal } from './components/idle-modal';
export { useImpersonationIdleTimer } from './use-impersonation-idle-timer';
export { useImpersonationSession } from './use-impersonation-session';
export type { ImpersonationFormValues } from './schemas';
export type { ImpersonationProfile, ImpersonationTier } from './types';
