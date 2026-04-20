/**
 * Plugin signers feature — barrel exports (Plan 6).
 */
export {
  useSignerList,
  useSignerDetail,
  useSignerPlugins,
  createSigner,
  updateSigner,
  deleteSigner,
  verifySigner,
  revokeSigner,
} from './api';

export { SignerList } from './components/list';
export { SignerDetail } from './components/detail';
export { SignerForm } from './components/form';
export { SignerFilterBar } from './components/filter-bar';

export {
  createSignerSchema,
  updateSignerSchema,
} from './schemas';
export type {
  CreateSignerFormValues,
  UpdateSignerFormValues,
} from './schemas';

export { SignerInUseError } from './types';
export type {
  SignerFilter,
  CreateSignerInput,
  UpdateSignerInput,
  PluginSigner,
  Plugin,
  ID,
} from './types';
