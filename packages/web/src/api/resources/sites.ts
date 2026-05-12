// Types for the sites resource surface.

import type { ID } from './common';

export interface Site {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  domain: string;
  tls_mode: 'auto' | 'manual' | 'off';
  enabled: boolean;
  readonly created_at: string;
  upstream_service_id?: ID;
  tls_manual_cert?: { cert_pem_preview: string; key_pem_preview: string; expires_at?: string };
  basic_auth_enabled: boolean;
  rate_limit_preset: 'none' | 'lenient' | 'standard' | 'strict';
  redirect_rules: { from: string; to: string; status: 301 | 302 | 307 | 308 }[];
  readonly updated_at: string;
}
