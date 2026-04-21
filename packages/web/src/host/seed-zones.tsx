/**
 * seed-zones — Demo zone contributions registered during mock-store seeding.
 *
 * Purpose: exercise the "plugin has settings" code path in both the running
 * dev app and test suites without requiring a real plugin loader.
 *
 * Registered zones:
 *   plugin-settings.com.acme.billing — Acme Billing settings placeholder card
 *
 * Called from `api/mock-seed.ts` at the end of `seedStore()`.
 *
 * Task 8c.12 — Zone seed for plugin-settings integration.
 */

import { Alert, Stack, Text } from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';
import { registerZone, unregisterZone } from './zones';

// ─── Demo components ──────────────────────────────────────────────────────────

function AcmeBillingSettingsPanel() {
  return (
    <Stack gap="sm" data-testid="zone-acme-billing-settings">
      <Alert
        icon={<IconSettings size={14} />}
        color="blue"
        variant="light"
        title="Acme Billing settings"
      >
        <Text size="xs">
          Demo placeholder — the Acme Billing plugin settings panel would render here.
          (Stage-1 seed contribution for zone <code>plugin-settings.com.acme.billing</code>.)
        </Text>
      </Alert>
    </Stack>
  );
}

// ─── Registration ─────────────────────────────────────────────────────────────

let seeded = false;
let registeredId: string | undefined;

/**
 * Register demo zone contributions once.
 * Guarded by `seeded` flag so repeated `seedStore()` calls in tests don't
 * accumulate duplicate contributions.
 */
export function seedZones(): void {
  if (seeded) return;
  seeded = true;

  registeredId = registerZone({
    zone: 'plugin-settings.com.acme.billing',
    component: AcmeBillingSettingsPanel,
    source: 'plugin',
    pluginName: 'com.acme.billing',
  });
}

/**
 * Unregister all seed zone contributions and reset the seeded flag.
 * For test isolation only — call in beforeEach to start each test clean.
 */
export function resetSeedZones(): void {
  if (registeredId !== undefined) {
    unregisterZone(registeredId);
    registeredId = undefined;
  }
  seeded = false;
}
