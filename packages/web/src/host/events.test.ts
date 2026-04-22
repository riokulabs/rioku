import { describe, it, expect, vi } from 'vitest';
import { subscribeHostEvent, emitHostEvent } from './events';

describe('subscribeHostEvent / emitHostEvent', () => {
  it('handler receives emitted data', () => {
    const handler = vi.fn();
    const unsub = subscribeHostEvent('service:created', handler);
    emitHostEvent('service:created', { id: 'svc-1', name: 'My Service' });
    expect(handler).toHaveBeenCalledWith({ id: 'svc-1', name: 'My Service' });
    unsub();
  });

  it('handler is not called after unsubscribe', () => {
    const handler = vi.fn();
    const unsub = subscribeHostEvent('service:updated', handler);
    unsub();
    emitHostEvent('service:updated', { id: 'svc-1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple subscribers on the same topic all receive the event', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const unsub1 = subscribeHostEvent('plugin:enabled', h1);
    const unsub2 = subscribeHostEvent('plugin:enabled', h2);
    emitHostEvent('plugin:enabled', { name: 'my-plugin' });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
    unsub1();
    unsub2();
  });

  it('events on different topics do not cross-fire', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const unsub1 = subscribeHostEvent('user:created', h1);
    const unsub2 = subscribeHostEvent('tenant:created', h2);
    emitHostEvent('user:created', { id: 'u1' });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).not.toHaveBeenCalled();
    unsub1();
    unsub2();
  });

  it('returns an unsubscribe function', () => {
    const unsub = subscribeHostEvent('audit:new', vi.fn());
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
