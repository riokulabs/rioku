/**
 * Types for the impersonation feature.
 * spec §8.2 / Task 1d.75
 */

export type ImpersonationProfile = 'minimal' | 'full';

export type ImpersonationTier = 'read' | 'read-sensitive' | 'write' | 'destructive';

export interface ImpersonationFormValues {
  tenant_id: string;
  user_id?: string;
  reason: string;
  ticketRef?: string;
  totpCode: string;
  profile: ImpersonationProfile;
  additionalScope: ImpersonationTier[];
}
