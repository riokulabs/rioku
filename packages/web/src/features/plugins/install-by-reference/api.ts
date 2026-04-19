/**
 * Install-by-reference API surface.
 *
 * There is no mutation in this feature — submitting any of the three
 * sub-forms hands off an `InstallCandidate` to the install-approval modal,
 * which owns the actual `installPlugin` call into the mock store.
 *
 * Exported helpers are the client-side validators so tests can exercise
 * them directly without rendering the form.
 */
export { validateManifestUrl, LOOKALIKE_BLOCKLIST } from './schemas';
