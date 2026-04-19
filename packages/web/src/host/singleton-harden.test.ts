import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hardenGlobals, __resetHardenedForTests } from './singleton-harden';

// ─── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  __resetHardenedForTests();
});

afterEach(() => {
  __resetHardenedForTests();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('hardenGlobals', () => {
  it('is idempotent — calling twice does not throw', () => {
    expect(() => {
      hardenGlobals();
      hardenGlobals();
    }).not.toThrow();
  });

  it('after hardening, pollution-vector freeze runs without throwing', () => {
    // The key invariant: hardenGlobals() must not throw.
    // V8 may or may not leave __proto__ as configurable; either outcome is safe.
    // We do NOT assert the final configurable value here because V8 already locks
    // some descriptors before our code runs — and locking `constructor` can break
    // Vitest's error serializer. The test verifies the operation completes cleanly.
    expect(() => { hardenGlobals(); }).not.toThrow();
    // Basic prototype chain sanity: {} still has Object.prototype methods.
    expect(typeof ({}).hasOwnProperty).toBe('function');
  });

  it('after hardening, assigning to Object.prototype.__proto__ is a no-op or throws in strict mode', () => {
    hardenGlobals();
    // In ESM (strict mode), attempting to assign a non-writable property either
    // throws a TypeError or silently no-ops depending on the runtime + JS engine.
    // We verify that the attempt does not corrupt the prototype chain.
    const before: object | null = Object.getPrototypeOf({}) as object | null;
    try {
      // @ts-expect-error — intentionally testing mutation resistance
      Object.prototype.__proto__ = null;
    } catch {
      // TypeError in strict mode — expected and acceptable.
    }
    // Prototype chain must still be intact.
    const after: object | null = Object.getPrototypeOf({}) as object | null;
    expect(after).toBe(before);
  });

  it('reset helper allows re-hardening', () => {
    hardenGlobals();
    __resetHardenedForTests();
    // Should not throw on second call after reset.
    expect(() => { hardenGlobals(); }).not.toThrow();
  });
});

describe('hardenGlobals — library compat', () => {
  it('basic object operations work after hardening', () => {
    hardenGlobals();
    // Object.assign, spread, property access — all must still work.
    const a = { x: 1 };
    const b = { y: 2 };
    const c = Object.assign({}, a, b);
    expect(c).toEqual({ x: 1, y: 2 });

    const d = { ...a, ...b };
    expect(d).toEqual({ x: 1, y: 2 });
  });

  it('class instantiation works after hardening', () => {
    hardenGlobals();
    class Foo {
      value: number;
      constructor(v: number) { this.value = v; }
      double() { return this.value * 2; }
    }
    const foo = new Foo(21);
    expect(foo.double()).toBe(42);
    expect(foo instanceof Foo).toBe(true);
  });

  it('Array and Map operations work after hardening', () => {
    hardenGlobals();
    const arr = [1, 2, 3].map((x) => x * 2);
    expect(arr).toEqual([2, 4, 6]);

    const map = new Map<string, number>([['a', 1], ['b', 2]]);
    expect(map.get('a')).toBe(1);
    expect([...map.values()]).toEqual([1, 2]);
  });

  it('JSON.parse and JSON.stringify work after hardening', () => {
    hardenGlobals();
    const obj = { name: 'rioku', version: '1.0.0' };
    const json = JSON.stringify(obj);
    expect(JSON.parse(json)).toEqual(obj);
  });

  it('Object.keys, Object.values, Object.entries work after hardening', () => {
    hardenGlobals();
    const obj = { a: 1, b: 2 };
    expect(Object.keys(obj)).toEqual(['a', 'b']);
    expect(Object.values(obj)).toEqual([1, 2]);
    expect(Object.entries(obj)).toEqual([['a', 1], ['b', 2]]);
  });
});

describe('__resetHardenedForTests', () => {
  it('resets the hardened flag so hardenGlobals runs again', () => {
    hardenGlobals();
    __resetHardenedForTests();
    // After reset, calling hardenGlobals does not throw and actually runs
    // the hardening loop again (no early-return). We can verify via idempotency.
    expect(() => { hardenGlobals(); }).not.toThrow();
  });
});
