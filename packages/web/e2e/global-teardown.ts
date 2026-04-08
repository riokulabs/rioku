import type { FullConfig } from '@playwright/test';

async function globalTeardown(_config: FullConfig): Promise<void> {
  // Sandbox lifecycle is managed externally (Makefile / CI).
  // Nothing to tear down here. Placeholder for future cleanup.
}

export default globalTeardown;
