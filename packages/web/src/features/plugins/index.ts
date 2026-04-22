/**
 * Plugins feature — top-level barrel.
 *
 * Re-exports each sub-feature's barrel so routes can import everything from
 * `@/features/plugins`.
 */
export * from './installed';
export * from './marketplace';
export * from './install-by-reference';
export * from './install-approval';
