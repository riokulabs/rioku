/**
 * Canonical TLS cipher suite constants.
 *
 * Single source of truth for the cipher lists used by both the UI component
 * (tls-cipher-config.tsx) and the mock seed (api/mock-seed.ts).
 */

/** All cipher suites surfaced in the MultiSelect — TLS 1.3 + TLS 1.2. */
export const ALL_TLS_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  // Additional legacy-compatible options (TLS 1.2)
  'ECDHE-RSA-AES128-SHA256',
  'ECDHE-RSA-AES256-SHA384',
] as const;

/**
 * Default cipher selection used in seeded mock data.
 * Subset of ALL_TLS_CIPHERS — excludes the two legacy TLS 1.2 entries.
 */
export const DEFAULT_TLS_CIPHERS: string[] = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
];
