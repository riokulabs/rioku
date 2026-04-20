import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emitPluginNotification, setNotifyBackend } from './notify';
import type { NotifyBackend } from './notify';

function makeBackend(): { backend: NotifyBackend; writes: ReturnType<typeof vi.fn> } {
  const writes = vi.fn();
  const backend: NotifyBackend = { write: writes };
  return { backend, writes };
}

beforeEach(() => {
  const { backend } = makeBackend();
  setNotifyBackend(backend);
});

describe('emitPluginNotification', () => {
  it('calls the backend write with an id and createdAt', () => {
    const writes = vi.fn();
    setNotifyBackend({ write: writes });
    emitPluginNotification({
      pluginName: 'my-plugin',
      category: 'plugin:my-plugin:alert',
      title: 'Hello',
      body: 'World',
      severity: 'info',
    });
    expect(writes).toHaveBeenCalledOnce();
    const arg = writes.mock.calls[0]?.[0] as { id: string; createdAt: string; title: string } | undefined;
    expect(typeof arg?.id).toBe('string');
    expect(typeof arg?.createdAt).toBe('string');
    expect(arg?.title).toBe('Hello');
  });

  it('throws if category does not start with plugin:<name>:', () => {
    expect(() => {
      emitPluginNotification({
        pluginName: 'my-plugin',
        category: 'plugin:other-plugin:alert',
        title: 'Bad',
        body: 'Bad',
        severity: 'error',
      });
    }).toThrow(/must start with/i);
  });

  it('throws if category has no plugin: prefix at all', () => {
    expect(() => {
      emitPluginNotification({
        pluginName: 'my-plugin',
        category: 'arbitrary:category',
        title: 'Bad',
        body: 'Bad',
        severity: 'error',
      });
    }).toThrow(/must start with/i);
  });

  it('valid category with correct prefix succeeds', () => {
    const { backend, writes } = makeBackend();
    setNotifyBackend(backend);
    expect(() => {
      emitPluginNotification({
        pluginName: 'acme-billing',
        category: 'plugin:acme-billing:invoice-overdue',
        title: 'Invoice overdue',
        body: 'Invoice #123 is overdue',
        severity: 'warn',
        tenant: 'tenant-0001',
      });
    }).not.toThrow();
    expect(writes).toHaveBeenCalled();
  });

  it('accepts dot-separated plugin categories (plugin:<name>.sub.sub)', () => {
    const { backend, writes } = makeBackend();
    setNotifyBackend(backend);
    emitPluginNotification({
      pluginName: 'com.rioku.slack',
      category: 'plugin:com.rioku.slack.channel-created',
      title: 't',
      body: 'b',
      severity: 'info',
    });
    expect(writes).toHaveBeenCalled();
  });

  it('forwards an optional action payload to the backend', () => {
    const { backend, writes } = makeBackend();
    setNotifyBackend(backend);
    emitPluginNotification({
      pluginName: 'acme',
      category: 'plugin:acme:done',
      title: 't',
      body: 'b',
      severity: 'success',
      action: { label: 'Open', href: '/somewhere' },
    });
    const arg = writes.mock.calls[0]?.[0] as { action?: { label: string; href: string } };
    expect(arg.action).toEqual({ label: 'Open', href: '/somewhere' });
  });
});
