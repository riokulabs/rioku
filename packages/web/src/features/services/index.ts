/**
 * Services feature — barrel exports.
 */
export {
  useServiceList,
  useServiceDetail,
  useServiceRoutes,
  createService,
  updateService,
  deleteService,
  forceReloadService,
} from './api';
export {
  createServiceSchema,
  updateServiceSchema,
} from './schemas';
export type { CreateServiceFormValues, UpdateServiceFormValues } from './schemas';
export {
  ServiceInUseError,
} from './types';
export type { ServiceFilter, ServiceInput, ServiceUpdateInput } from './types';
export { ServiceList } from './components/list';
export { ServiceFilterBar } from './components/filter-bar';
export { ServiceForm } from './components/form';
export { ServiceDetail } from './components/detail';
