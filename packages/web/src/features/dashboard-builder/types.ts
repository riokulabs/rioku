/**
 * Dashboard-builder feature-local types.
 */
export type { Dashboard, Widget, ID } from '@/api/resources/types';

export interface AddWidgetInput {
  kind: string;
  title: string;
  data_source: string;
  config?: Record<string, unknown>;
  raw_query?: string;
  wizard_state?: import('@/api/resources/types').WidgetWizardState;
  position?: { x: number; y: number; w: number; h: number };
}

export interface UpdateWidgetInput {
  title?: string;
  kind?: string;
  data_source?: string;
  config?: Record<string, unknown>;
  raw_query?: string;
  wizard_state?: import('@/api/resources/types').WidgetWizardState;
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
