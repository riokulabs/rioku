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
export * from './manifest-validate';
export * from './sideload';
export { useDaemonCapabilities } from './use-daemon-capabilities';
export type { DaemonCapabilities } from './use-daemon-capabilities';
export { PluginBuildLogStream } from './installed/components/build-log-stream';
export { PluginDisabledTooltip } from './installed/components/disabled-tooltip';
