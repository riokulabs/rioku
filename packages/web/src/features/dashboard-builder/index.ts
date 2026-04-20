/**
 * Dashboard-builder feature — barrel exports.
 */
export {
  useWidgetData,
  addWidget,
  updateWidget,
  removeWidget,
  updateLayout,
  flipWidgetToAdvanced,
  flipWidgetToWizard,
} from './api';

export {
  addWidgetSchema,
  updateWidgetSchema,
  layoutSchema,
} from './schemas';

export {
  LayoutValidationError,
  WidgetFlipError,
} from './types';
export type {
  AddWidgetInput,
  UpdateWidgetInput,
  WidgetDataState,
  WizardDraft,
  DataSourceDescriptor,
  AskQuestionWizardProps,
  WidgetConfigPanelProps,
} from './types';

export { SchemaForm } from './components/schema-form';
export type { SchemaFormProps } from './components/schema-form';

export { GridCanvas } from './components/grid-canvas';
export type { GridCanvasProps } from './components/grid-canvas';
export { WidgetPalette } from './components/widget-palette';
export type { WidgetPaletteProps } from './components/widget-palette';
export { AskQuestionWizard } from './components/ask-question-wizard';
export { WidgetConfigPanel } from './components/widget-config-panel';
export { AdvancedEditor } from './components/advanced-editor';
export type { AdvancedEditorProps } from './components/advanced-editor';
export { ModeFlipConfirmDialog } from './components/mode-flip-confirm';
export type { ModeFlipConfirmDialogProps } from './components/mode-flip-confirm';
export { DashboardBuilderShell } from './components/builder-shell';
export type { DashboardBuilderShellProps } from './components/builder-shell';
