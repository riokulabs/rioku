/**
 * Shared constants used across plugin sub-features (installed, marketplace,
 * install-approval, install-by-reference).
 */
import type { Plugin } from '@/api/resources';

/** Badge colors for the three plugin surface parts. */
export const PART_COLORS: Record<Plugin['parts'][number], string> = {
  daemon: 'blue',
  caddy: 'teal',
  admin: 'violet',
};
