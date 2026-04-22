/**
 * Feature-local types for sites.
 */
export type { Site, Service, ID } from '@/api/resources/types';

import type { Site } from '@/api/resources/types';

export type SiteEnabledFilter = 'enabled' | 'disabled';

export interface SiteFilter {
  /** Domain / name substring (case-insensitive). Empty = match all. */
  search: string;
  /** TLS modes to include. Empty array = match all. */
  tls_mode: Site['tls_mode'][];
  /** Enabled/disabled set. Empty = match all. */
  enabled: SiteEnabledFilter[];
  /** Service IDs to include as linked upstream. Empty = match all. */
  linked_service_ids: string[];
}

export interface SiteWizardInput {
  name: string;
  domain: string;
  upstream_mode: 'existing_service' | 'new_upstream';
  upstream_service_id?: string;
  upstream_protocol?: 'http' | 'https' | 'grpc';
  upstream_host?: string;
  upstream_port?: number;
  tls_mode: Site['tls_mode'];
  tls_manual_cert_pem?: string;
  tls_manual_key_pem?: string;
  basic_auth_enabled?: boolean;
  rate_limit_preset?: Site['rate_limit_preset'];
  redirect_rules?: Site['redirect_rules'];
}

export interface SiteUpdateInput {
  name?: string;
  domain?: string;
  tls_mode?: Site['tls_mode'];
  /**
   * Link the site to a service. Pass an ID to link, omit the field to leave
   * untouched. To unlink a site from a service, delete + re-create the site
   * (rare in real workflows; wizard-driven in stage 1).
   */
  upstream_service_id?: string;
  basic_auth_enabled?: boolean;
  rate_limit_preset?: Site['rate_limit_preset'];
  redirect_rules?: Site['redirect_rules'];
}
