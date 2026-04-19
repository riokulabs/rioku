import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerSpotlightCommand,
  unregisterSpotlightCommand,
  listSpotlightCommands,
  registerSpotlightResource,
  unregisterSpotlightResource,
  listSpotlightResources,
} from './spotlight';

const registeredCommandIds: string[] = [];

function regCmd(label = 'Test Command', id?: string): string {
  const rid = registerSpotlightCommand({
    label,
    onAction: vi.fn(),
    source: 'plugin',
    pluginName: 'test',
    ...(id ? { id } : {}),
  });
  registeredCommandIds.push(rid);
  return rid;
}

beforeEach(() => {
  while (registeredCommandIds.length > 0) {
    const id = registeredCommandIds.pop();
    if (id !== undefined) unregisterSpotlightCommand(id);
  }
  listSpotlightResources().forEach((r) => { unregisterSpotlightResource(r.type); });
});

// ─── Commands ─────────────────────────────────────────────────────────────────

describe('registerSpotlightCommand', () => {
  it('returns a generated id when none provided', () => {
    const id = regCmd();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('uses provided id if given', () => {
    const id = regCmd('Custom', 'my-custom-id');
    expect(id).toBe('my-custom-id');
    unregisterSpotlightCommand('my-custom-id');
    const idx = registeredCommandIds.indexOf(id);
    if (idx !== -1) registeredCommandIds.splice(idx, 1);
  });

  it('overwrites existing command with same id', () => {
    regCmd('First', 'shared-id');
    const id2 = regCmd('Second', 'shared-id');
    expect(id2).toBe('shared-id');
    const cmds = listSpotlightCommands().filter((c) => c.id === 'shared-id');
    expect(cmds).toHaveLength(1);
    expect(cmds[0]?.label).toBe('Second');
    unregisterSpotlightCommand('shared-id');
    const idx = registeredCommandIds.indexOf('shared-id');
    if (idx !== -1) registeredCommandIds.splice(idx, 1);
  });
});

describe('listSpotlightCommands', () => {
  it('returns all registered commands', () => {
    regCmd('A');
    regCmd('B');
    expect(listSpotlightCommands().length).toBeGreaterThanOrEqual(2);
  });
});

describe('unregisterSpotlightCommand', () => {
  it('removes the command', () => {
    const id = regCmd('Remove me');
    expect(listSpotlightCommands().find((c) => c.id === id)).toBeDefined();
    unregisterSpotlightCommand(id);
    const idx = registeredCommandIds.indexOf(id);
    if (idx !== -1) registeredCommandIds.splice(idx, 1);
    expect(listSpotlightCommands().find((c) => c.id === id)).toBeUndefined();
  });

  it('no-ops for unknown id', () => {
    expect(() => { unregisterSpotlightCommand('ghost'); }).not.toThrow();
  });
});

// ─── Resources ────────────────────────────────────────────────────────────────

describe('registerSpotlightResource', () => {
  it('adds a resource by type', () => {
    registerSpotlightResource({ type: 'service', search: vi.fn(), source: 'plugin', pluginName: 'test' });
    expect(listSpotlightResources().find((r) => r.type === 'service')).toBeDefined();
  });

  it('overwrites resource with same type', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    registerSpotlightResource({ type: 'dup', search: fn1, source: 'plugin' });
    registerSpotlightResource({ type: 'dup', search: fn2, source: 'plugin' });
    const resources = listSpotlightResources().filter((r) => r.type === 'dup');
    expect(resources).toHaveLength(1);
    expect(resources[0]?.search).toBe(fn2);
  });
});

describe('unregisterSpotlightResource', () => {
  it('removes the resource', () => {
    registerSpotlightResource({ type: 'removable', search: vi.fn(), source: 'plugin' });
    unregisterSpotlightResource('removable');
    expect(listSpotlightResources().find((r) => r.type === 'removable')).toBeUndefined();
  });

  it('no-ops for unknown type', () => {
    expect(() => { unregisterSpotlightResource('ghost'); }).not.toThrow();
  });
});
