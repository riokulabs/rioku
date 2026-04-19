import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSubscription } from './use-subscription';
import { mockBus, publishMock } from '@/api/mock-sse';

describe('useSubscription', () => {
  it('receives a published event', () => {
    const handler = vi.fn();
    renderHook(() => { useSubscription<{ value: number }>('test.topic', handler); });

    act(() => {
      publishMock('test.topic', { value: 42 });
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  it('does not receive events for a different topic', () => {
    const handler = vi.fn();
    renderHook(() => { useSubscription('test.other', handler); });

    act(() => {
      publishMock('test.unrelated', { value: 1 });
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('receives multiple events in order', () => {
    const received: number[] = [];
    renderHook(() => {
      useSubscription<number>('test.multi', (v) => { received.push(v); });
    });

    act(() => {
      publishMock('test.multi', 1);
      publishMock('test.multi', 2);
      publishMock('test.multi', 3);
    });

    expect(received).toEqual([1, 2, 3]);
  });

  it('does not re-subscribe when handler identity changes', () => {
    const addSpy = vi.spyOn(mockBus, 'addEventListener');
    const removeSpy = vi.spyOn(mockBus, 'removeEventListener');

    const { rerender } = renderHook(() => {
      // New function identity on every render — counter tracks invocations
      useSubscription('test.rerender', (_v: unknown) => { /* intentionally empty */ });
    });

    const initialAddCount = addSpy.mock.calls.length;
    const initialRemoveCount = removeSpy.mock.calls.length;

    rerender();
    rerender();

    // Should not have added or removed any extra listeners
    expect(addSpy.mock.calls.length).toBe(initialAddCount);
    expect(removeSpy.mock.calls.length).toBe(initialRemoveCount);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('unsubscribes on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => {
      useSubscription<string>('test.cleanup', handler);
    });

    unmount();

    act(() => {
      publishMock('test.cleanup', 'after-unmount');
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('re-subscribes when topic changes', () => {
    const handler = vi.fn();
    const addSpy = vi.spyOn(mockBus, 'addEventListener');
    const initialCount = addSpy.mock.calls.length;

    const { rerender } = renderHook(
      ({ topic }: { topic: string }) => { useSubscription(topic, handler); },
      { initialProps: { topic: 'topic.a' } },
    );

    rerender({ topic: 'topic.b' });

    // One extra addEventListener call for the new topic
    expect(addSpy.mock.calls.length).toBe(initialCount + 2); // mount + rerender

    addSpy.mockRestore();
  });
});
