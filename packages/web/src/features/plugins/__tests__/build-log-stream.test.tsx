/**
 * Unit tests for <PluginBuildLogStream>.
 *
 * Polyfills EventSource so we can drive the stream deterministically.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { PluginBuildLogStream } from '../installed/components/build-log-stream';

let activeFakeES: StubEventSource | null = null;

class StubEventSource {
  url: string;
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    activeFakeES = this;
  }
  addEventListener(name: string, fn: (ev: MessageEvent) => void): void {
    (this.listeners[name] ??= []).push(fn);
  }
  close(): void {
    this.closed = true;
  }
  emit(name: string, payload: string): void {
    const fns = this.listeners[name] ?? [];
    const ev = { data: payload, type: name } as unknown as MessageEvent;
    for (const f of fns) f(ev);
  }
}

const RealEventSource = globalThis.EventSource;

beforeEach(() => {
  activeFakeES = null;
  // @ts-expect-error - test stub
  globalThis.EventSource = StubEventSource;
});
afterEach(() => {
  globalThis.EventSource = RealEventSource;
});

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('<PluginBuildLogStream>', () => {
  it('subscribes when buildState=building and renders streamed lines', async () => {
    wrap(<PluginBuildLogStream pluginId="p-1" tenantId="tenant-1" buildState="building" />);

    expect(screen.getByLabelText('plugin-build-log-stream')).toBeTruthy();

    await waitFor(() => { expect(activeFakeES).not.toBeNull(); });
    const es = activeFakeES;
    if (!es) throw new Error('no EventSource');
    expect(es.url).toContain('/t/tenant-1/plugins/p-1/build-log/stream');

    // eslint-disable-next-line @typescript-eslint/require-await
    await act(async () => {
      es.emit('log', 'compiling foo.go');
      es.emit('log', 'compiling bar.go');
    });

    await waitFor(() => screen.getByText('compiling foo.go'));
    expect(screen.getByText('compiling bar.go')).toBeTruthy();
  });

  it('shows "Build complete" after a `complete` event', async () => {
    wrap(<PluginBuildLogStream pluginId="p-2" tenantId="tenant-1" buildState="building" />);
    await waitFor(() => { expect(activeFakeES).not.toBeNull(); });
    const es = activeFakeES;
    if (!es) throw new Error('no EventSource');

    // eslint-disable-next-line @typescript-eslint/require-await
    await act(async () => {
      es.emit('log', 'done');
      es.emit('complete', '');
    });

    await waitFor(() => screen.getByText(/Build complete/i));
    expect(es.closed).toBe(true);
  });

  it('renders nothing when buildState is stable and no logs were captured', () => {
    const { container } = wrap(
      <PluginBuildLogStream pluginId="p-3" tenantId="tenant-1" buildState="stable" />,
    );
    expect(container.querySelector('[aria-label="plugin-build-log-stream"]')).toBeNull();
  });
});
