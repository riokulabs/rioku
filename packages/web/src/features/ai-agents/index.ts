/**
 * AI Agents feature — barrel exports.
 */
export {
  useAgentList,
  useAgentDetail,
  useAgentTools,
  useAgentTraces,
  useCreateAgent,
  useUpdateAgent,
  useDeleteAgent,
  useRotateAgentCredential,
  createAgent,
  updateAgent,
  deleteAgent,
  rotateScopedCredential,
  invokeAgent,
} from './api';

export type {
  RotateAgentCredentialResult,
  InvokeAgentHandlers,
  InvokeChunk,
  InvokeDoneSummary,
} from './api';

export {
  createAgentSchema,
  updateAgentSchema,
  rotateScopedCredentialSchema,
  invokeAgentSchema,
} from './schemas';
export type {
  CreateAgentFormValues,
  UpdateAgentFormValues,
  RotateScopedCredentialFormValues,
  InvokeAgentFormValues,
} from './schemas';

export type { AgentFilter, CreateAgentInput, UpdateAgentInput, InvokeAgentInput } from './types';

export { AgentList } from './components/list';
export { AgentFilterBar } from './components/filter-bar';
export { AgentDetail } from './components/detail';
export { AgentForm } from './components/form';
export { InvokePanel } from './components/invoke-panel';
export { ToolSelector } from './components/tool-selector';
export { AgentDrawer } from './components/drawer';
export { AgentFullPage } from './components/full-page';
