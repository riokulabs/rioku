/**
 * Install-by-reference feature — barrel exports.
 */
export { InstallByReferenceForms } from './components/forms';
export { validateManifestUrl, LOOKALIKE_BLOCKLIST } from './api';
export type { InstallCandidate } from './types';
export type {
  OciFormValues,
  TarballFormValues,
  ManifestUrlFormValues,
} from './schemas';
