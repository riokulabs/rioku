/**
 * Services feature — barrel exports.
 *
 * Stage 2: imperative mutations + selectors are real-endpoint backed
 * (see `api.ts`, which proxies to `api.stage2.ts`). Mutation-hook variants
 * are also exported for components that prefer the TanStack Query surface.
 */
export {
  // Selectors
  useServiceList,
  useServiceDetail,
  useServiceRoutes,
  // Imperative mutations (real endpoints)
  createService,
  updateService,
  deleteService,
  enableService,
  disableService,
  forceReloadService,
  // Mutation hooks (TanStack Query surface)
  useServiceListReal,
  useServiceDetailReal,
  useCreateServiceMutation,
  useUpdateServiceMutation,
  useDeleteServiceMutation,
  useEnableServiceMutation,
  useDisableServiceMutation,
  useForceReloadServiceMutation,
} from './api';
export { createServiceSchema, updateServiceSchema } from './schemas';
export type { CreateServiceFormValues, UpdateServiceFormValues } from './schemas';
export { ServiceInUseError } from './types';
export type { ServiceFilter, ServiceInput, ServiceUpdateInput } from './types';
export { ServiceList } from './components/list';
export { ServiceFilterBar } from './components/filter-bar';
export { ServiceForm } from './components/form';
export { ServiceDetail } from './components/detail';
export { ServiceDrawer } from './components/drawer';
export type { ServiceDrawerProps } from './components/drawer';
export { ServiceFullPage } from './components/full-page';
export type { ServiceFullPageProps } from './components/full-page';
