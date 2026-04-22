export type TenantMode = 'path-prefix' | 'subdomain' | 'single-tenant';

// Simple detection: for stage 1, read a VITE env. Later Plan 1d wires tenant resolution.
export function detectTenantMode(): TenantMode {
  const raw: unknown = import.meta.env.VITE_TENANT_MODE;
  if (raw === 'subdomain' || raw === 'single-tenant') return raw;
  return 'path-prefix';
}

export function useActiveTenantSlug(): string | null {
  const mode = detectTenantMode();
  if (mode === 'subdomain') {
    const host = window.location.hostname;
    const first = host.split('.')[0];
    return first && first !== 'admin' ? first : null;
  }
  if (mode === 'single-tenant') return null;
  // path-prefix: read /t/:tenant/* from URL
  const match = /^\/t\/([^/]+)/.exec(window.location.pathname);
  return match?.[1] ?? null;
}

export function useTenant() {
  const slug = useActiveTenantSlug();
  return { slug, mode: detectTenantMode() };
}
