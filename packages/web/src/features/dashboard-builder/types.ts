/**
 * Dashboard-builder feature-local types.
 */
import type { Widget, WidgetWizardState } from '@/api/resources';

export type { Dashboard, Widget, ID } from '@/api/resources';

export interface AddWidgetInput {
  kind: string;
  title: string;
  data_source: string;
  config?: Record<string, unknown>;
  raw_query?: string;
  wizard_state?: WidgetWizardState;
  position?: { x: number; y: number; w: number; h: number };
}

export interface UpdateWidgetInput {
  title?: string;
  kind?: string;
  data_source?: string;
  config?: Record<string, unknown>;
  raw_query?: string;
  wizard_state?: WidgetWizardState;
  locked_advanced?: boolean;
}

export interface WidgetDataState {
  data: unknown;
  loading: boolean;
  error?: string;
}

export class WidgetFlipError extends Error {
  readonly code = 'WIDGET_FLIP_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'WidgetFlipError';
  }
}

export class LayoutValidationError extends Error {
  readonly code = 'LAYOUT_VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'LayoutValidationError';
  }
}

// ─── Wizard + config-panel types ──────────────────────────────────────────────

export interface WizardDraft {
  title: string;
  kind: string;
  data_source: string;
  wizard_state: WidgetWizardState;
}

export interface DataSourceDescriptor {
  id: string;
  label: string;
  description: string;
}

export interface AskQuestionWizardProps {
  dashboardId: string;
  /** When editing an existing widget, provide it; omit for create. */
  widget?: Widget;
  mode: 'create' | 'edit';
  onSave: (widget: Widget) => void;
  onCancel: () => void;
}

export interface WidgetConfigPanelProps {
  dashboardId: string;
  widget: Widget;
  onSave: (widget: Widget) => void;
  onClose: () => void;
}
