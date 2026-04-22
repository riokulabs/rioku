const RESERVED = new Set([
  'admin',
  'api',
  'plugins',
  '_plugins',
  '_assets',
  'bootstrap',
  'login',
  't',
  'tenants',
]);

// Valid slug: starts and ends with alphanumeric, middle may contain hyphens.
// Single alphanumeric char is also valid. Max 64 chars total.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

export function isValidTenantSlug(s: string): boolean {
  return SLUG_RE.test(s) && !RESERVED.has(s);
}

export function tenantSlugError(s: string): string | null {
  if (!s) return 'Slug required';
  if (RESERVED.has(s)) return `"${s}" is reserved`;
  if (!SLUG_RE.test(s))
    return 'Lowercase letters, digits, hyphens. Max 64 chars. No leading/trailing hyphen.';
  return null;
}
