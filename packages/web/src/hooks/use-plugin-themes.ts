/**
 * usePluginThemes — bridge hook for plugin-registered themes.
 *
 * Re-exports `usePluginThemes` from `@/host/themes` through the hooks/ layer
 * so that app/ and components/ code that cannot import from host/ directly
 * can still access plugin themes reactively.
 *
 * (The `app/` boundary allows all imports, so providers.tsx can also import
 *  from host/ directly — but routing through hooks/ is cleaner and consistent.)
 */

export { usePluginThemes } from '@/host/themes';
