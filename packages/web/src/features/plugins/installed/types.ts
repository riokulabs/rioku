/**
 * Installed-plugins feature types.
 */
export type { Plugin, ID } from '@/api/resources';

/** Filter for the installed plugins list. */
export interface InstalledPluginFilter {
  search: string;
  enabled: 'all' | 'enabled' | 'disabled';
}
