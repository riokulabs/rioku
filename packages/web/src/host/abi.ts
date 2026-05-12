/**
 * ABI version constants + compatibility check.
 *
 * The admin host ABI version is a monotonically-increasing integer.
 * Plugins declare `abi.minVersion` (required) and `abi.maxVersion` (optional).
 * The host checks that its current ABI falls within the plugin's declared range.
 */

// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const CURRENT_ABI_VERSION: number = 1;
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const MIN_SUPPORTED_ABI: number = 1;

export interface AbiCompatibility {
  compatible: boolean;
  reason?: string;
}

export function checkAbiCompatibility(
  pluginMinAbi: number,
  pluginMaxAbi: number | undefined,
): AbiCompatibility {
  if (pluginMinAbi > CURRENT_ABI_VERSION) {
    return {
      compatible: false,
      reason: `plugin requires admin ABI >= ${String(pluginMinAbi)}, host is ${String(CURRENT_ABI_VERSION)}`,
    };
  }
  if (pluginMaxAbi !== undefined && pluginMaxAbi < CURRENT_ABI_VERSION) {
    return {
      compatible: false,
      reason: `plugin requires admin ABI <= ${String(pluginMaxAbi)}, host is ${String(CURRENT_ABI_VERSION)}`,
    };
  }
  if (CURRENT_ABI_VERSION < MIN_SUPPORTED_ABI) {
    return {
      compatible: false,
      reason: `admin ABI ${String(CURRENT_ABI_VERSION)} is below minimum supported ${String(MIN_SUPPORTED_ABI)}`,
    };
  }
  return { compatible: true };
}
