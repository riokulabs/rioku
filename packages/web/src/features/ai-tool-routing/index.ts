/**
 * AI Tool Routing (bindings) — barrel exports.
 */
export {
  useBindingList,
  useBindingDetail,
  createBinding,
  updateBinding,
  deleteBinding,
  bulkAttachToolsToAgent,
  previewCondition,
  useInvalidateBindings,
  bindingKeys,
} from './api';

export { createBindingSchema, updateBindingSchema } from './schemas';
export type { CreateBindingFormValues, UpdateBindingFormValues } from './schemas';

export type {
  BindingFilter,
  CreateBindingInput,
  UpdateBindingInput,
  PreviewConditionResult,
} from './types';

export { BindingList } from './components/list';
export { BindingFilterBar } from './components/filter-bar';
export { BindingForm } from './components/form';
export { BindingDetail } from './components/detail';
export { BindingDrawer } from './components/drawer';
export { BindingFullPage } from './components/full-page';
export { BulkAttachModal } from './components/bulk-attach';
export { MatrixView } from './components/matrix-view';

export { useAgentRefs, useToolRefs } from './refs';
export type { AgentRef, ToolRef } from './refs';
