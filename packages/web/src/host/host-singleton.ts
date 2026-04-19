/**
 * Host singleton — non-React way to get a `RiokuHost` instance.
 *
 * Used by the plugin loader to pass `host` to plugin default-export functions
 * at registration time, which happens outside React's component tree.
 *
 * The singleton is built once and reused; it is identical in shape to the
 * object returned by `useHost()` because both call `buildHost()`.
 *
 * spec §9.4.1
 */

import { buildHost } from './host-builder';
import type { RiokuHost } from '@/hooks/use-host';

let _instance: Readonly<RiokuHost> | undefined;

/**
 * Return the shared `RiokuHost` instance.
 *
 * Creating the instance is idempotent — subsequent calls return the same
 * frozen object.  Safe to call from module-level code or async functions.
 */
export function getHostInstance(): Readonly<RiokuHost> {
  _instance ??= buildHost();
  return _instance;
}
