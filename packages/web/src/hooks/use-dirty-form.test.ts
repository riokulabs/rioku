import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { UseFormReturnType } from '@mantine/form';

// --- Mocks ---

// Mock @mantine/modals before importing the hook
vi.mock('@mantine/modals', () => ({
  modals: {
    openConfirmModal: vi.fn(),
  },
}));

// Capture the shouldBlockFn and enableBeforeUnload passed to useBlocker so
// we can assert on them without needing a real router context.
let capturedShouldBlockFn: (() => boolean) | null = null;
let capturedEnableBeforeUnload: boolean | undefined;
let mockBlockerStatus: 'idle' | 'blocked' = 'idle';
let mockProceed = vi.fn();
let mockReset = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useBlocker: (opts: {
    shouldBlockFn: () => boolean;
    enableBeforeUnload?: boolean;
    withResolver?: boolean;
  }) => {
    capturedShouldBlockFn = opts.shouldBlockFn;
    capturedEnableBeforeUnload = opts.enableBeforeUnload;
    if (mockBlockerStatus === 'blocked') {
      return { status: 'blocked', proceed: mockProceed, reset: mockReset };
    }
    return { status: 'idle', proceed: undefined, reset: undefined };
  },
}));

// Import after mocks are in place
import { useDirtyForm } from './use-dirty-form';
import { modals } from '@mantine/modals';

function makeMockForm(dirty: boolean): UseFormReturnType<Record<string, unknown>> {
  return {
    isDirty: () => dirty,
  } as unknown as UseFormReturnType<Record<string, unknown>>;
}

describe('useDirtyForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedShouldBlockFn = null;
    capturedEnableBeforeUnload = undefined;
    mockBlockerStatus = 'idle';
    mockProceed = vi.fn();
    mockReset = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns isDirty=false when form is clean', () => {
    const form = makeMockForm(false);
    const { result } = renderHook(() => useDirtyForm(form));
    expect(result.current.isDirty).toBe(false);
  });

  it('returns isDirty=true when form is dirty', () => {
    const form = makeMockForm(true);
    const { result } = renderHook(() => useDirtyForm(form));
    expect(result.current.isDirty).toBe(true);
  });

  it('passes shouldBlockFn that returns form.isDirty()', () => {
    const form = makeMockForm(true);
    renderHook(() => useDirtyForm(form));
    expect(capturedShouldBlockFn).not.toBeNull();
    if (!capturedShouldBlockFn) throw new Error('shouldBlockFn not captured');
    expect(capturedShouldBlockFn()).toBe(true);
  });

  it('shouldBlockFn returns false when form is clean', () => {
    const form = makeMockForm(false);
    renderHook(() => useDirtyForm(form));
    if (!capturedShouldBlockFn) throw new Error('shouldBlockFn not captured');
    expect(capturedShouldBlockFn()).toBe(false);
  });

  it('disables TanStack Router built-in beforeUnload (hook manages it)', () => {
    const form = makeMockForm(false);
    renderHook(() => useDirtyForm(form));
    expect(capturedEnableBeforeUnload).toBe(false);
  });

  it('opens confirm modal when blocker is blocked', () => {
    mockBlockerStatus = 'blocked';
    const form = makeMockForm(true);
    renderHook(() => useDirtyForm(form));
    expect(modals.openConfirmModal).toHaveBeenCalledOnce();
    const firstCall = (modals.openConfirmModal as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!firstCall) throw new Error('openConfirmModal was not called');
    const callArgs = firstCall[0] as { labels: { confirm: unknown; cancel: unknown } };
    expect(callArgs.labels.confirm).toBeDefined();
    expect(callArgs.labels.cancel).toBeDefined();
  });

  it('does not open modal when blocker is idle', () => {
    mockBlockerStatus = 'idle';
    const form = makeMockForm(true);
    renderHook(() => useDirtyForm(form));
    expect(modals.openConfirmModal).not.toHaveBeenCalled();
  });

  it('registers beforeunload listener', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const form = makeMockForm(false);
    renderHook(() => useDirtyForm(form));
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('removes beforeunload listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const form = makeMockForm(false);
    const { unmount } = renderHook(() => useDirtyForm(form));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('beforeunload fires preventDefault when form is dirty', () => {
    const addListenerSpy = vi.spyOn(window, 'addEventListener');
    const form = makeMockForm(true);
    renderHook(() => useDirtyForm(form));

    // Extract the registered handler
    const handler = addListenerSpy.mock.calls.find(
      ([event]) => event === 'beforeunload',
    )?.[1] as EventListener | undefined;

    if (!handler) throw new Error('beforeunload handler not registered');

    const mockEvent = {
      preventDefault: vi.fn(),
      returnValue: '',
    };
    act(() => {
      handler(mockEvent as unknown as Event);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalled();
  });

  it('beforeunload does not fire when form is clean', () => {
    const addListenerSpy = vi.spyOn(window, 'addEventListener');
    const form = makeMockForm(false);
    renderHook(() => useDirtyForm(form));

    const handler = addListenerSpy.mock.calls.find(
      ([event]) => event === 'beforeunload',
    )?.[1] as EventListener | undefined;

    if (!handler) throw new Error('beforeunload handler not registered');

    const mockEvent = {
      preventDefault: vi.fn(),
      returnValue: '',
    };
    act(() => {
      handler(mockEvent as unknown as Event);
    });

    expect(mockEvent.preventDefault).not.toHaveBeenCalled();
  });
});
