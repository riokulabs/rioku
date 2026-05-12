/**
 * Singleton hardening — §9.4.1.
 *
 * Freezes specific pollution-vector properties on Object.prototype to block
 * prototype-pollution attacks from untrusted plugin code, without the broad
 * `Object.freeze(Object.prototype)` hammer (which breaks many libraries).
 */

// `constructor` is intentionally excluded: making it non-writable on
// Object.prototype breaks React, Mantine, Vitest, and any library that
// relies on class/prototype inheritance. The meaningful prototype-pollution
// vectors are the legacy non-standard accessor keys and __proto__.
const POLLUTION_VECTORS = [
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
] as const;

let hardened = false;

export function hardenGlobals(): void {
  if (hardened) return;
  hardened = true;

  // Freeze pollution-vector keys on Object.prototype
  for (const key of POLLUTION_VECTORS) {
    const desc = Object.getOwnPropertyDescriptor(Object.prototype, key);
    if (desc?.configurable) {
      try {
        Object.defineProperty(Object.prototype, key, {
          ...desc,
          configurable: false,
          writable: false,
        });
      } catch {
        // Some runtimes already lock these; silently skip.
      }
    }
  }

  // Suppress React DevTools reconciler hook for non-first-party plugin code.
  // Policy: first-party code gets DevTools in dev; third-party plugin code
  // shouldn't see it. We always suppress during production builds.
  // In DEV, we leave the hook intact so developer tools still work.
  if (typeof window !== 'undefined' && !import.meta.env.DEV) {
    if (!('__REACT_DEVTOOLS_GLOBAL_HOOK__' in window)) {
      (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        isDisabled: true,
        supportsFiber: true,
        inject: () => undefined,
        onCommitFiberRoot: () => undefined,
        onCommitFiberUnmount: () => undefined,
      };
    }
  }
}

/** Test helper — resets the hardened flag. Only call from tests. */
export function __resetHardenedForTests(): void {
  hardened = false;
}
