/**
 * plugin-validate.test.ts — Unit tests for Task 1f.116 bundle scanner.
 */

import { describe, it, expect } from 'vitest';
import { scanPluginBundle } from './plugin-validate';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid externalized plugin bundle — all deps imported, not bundled. */
const VALID_BUNDLE = `
import React from 'react';
import { Button } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

export default async function register(host) {
  // plugin code here
}
`.trim();

describe('scanPluginBundle', () => {
  it('passes a clean externalized bundle', () => {
    const result = scanPluginBundle(VALID_BUNDLE);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects bundled React (internal marker)', () => {
    const bundledReact =
      VALID_BUNDLE +
      '\nvar _react = __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;';
    const result = scanPluginBundle(bundledReact);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('react'))).toBe(true);
  });

  it('detects bundled @mantine/core (focus class marker)', () => {
    const bundledMantine = VALID_BUNDLE + "\nvar _cls = 'mantine-focus-auto foo bar';";
    const result = scanPluginBundle(bundledMantine);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('@mantine/core'))).toBe(true);
  });

  it('detects bundled @tanstack/react-query (QueryClientContext)', () => {
    const bundledQuery = VALID_BUNDLE + '\nvar QueryClientContext = createContext(null);';
    const result = scanPluginBundle(bundledQuery);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('@tanstack/react-query'))).toBe(true);
  });

  it('detects eval() usage', () => {
    const withEval = VALID_BUNDLE + "\neval('console.log(1)');";
    const result = scanPluginBundle(withEval);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('eval('))).toBe(true);
  });

  it('detects new Function() usage', () => {
    const withNewFn = VALID_BUNDLE + "\nconst fn = new Function('return 1');";
    const result = scanPluginBundle(withNewFn);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('new Function('))).toBe(true);
  });

  it('flags prototype pollution writes as warnings', () => {
    const polluted = VALID_BUNDLE + '\nObject.prototype.foo = function() {};';
    const result = scanPluginBundle(polluted);
    // Pollution is a warning, not an error
    expect(result.warnings.some((w) => w.includes('prototype pollution'))).toBe(true);
  });

  it('does not flag legitimate Object.prototype reads', () => {
    const safe = VALID_BUNDLE + '\nObject.prototype.hasOwnProperty.call(obj, "key");';
    const result = scanPluginBundle(safe);
    // Should not produce a pollution warning for reads
    expect(result.warnings.some((w) => w.includes('prototype pollution'))).toBe(false);
  });

  it('passes when @rioku/plugin-sdk appears only in an import statement', () => {
    // Valid — plugin imports from the SDK externally
    const validSdkImport = `import type { RiokuHost } from '@rioku/plugin-sdk';\nexport default async function register(host) {}`;
    const result = scanPluginBundle(validSdkImport);
    expect(result.ok).toBe(true);
  });

  it('warns when bundle has no external imports (likely fully bundled)', () => {
    // A large bundle with no import statements at all
    const noImports = 'var x = 1;\n'.repeat(60) + 'export default function() {}';
    const result = scanPluginBundle(noImports);
    expect(result.warnings.some((w) => w.includes('no imports from the required externals'))).toBe(true);
  });
});
