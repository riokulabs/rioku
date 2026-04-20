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
} from './types';
