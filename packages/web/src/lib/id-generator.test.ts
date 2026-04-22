import { describe, it, expect } from 'vitest';
import { makeIdFactory, resetFactory } from './id-generator';

describe('makeIdFactory', () => {
  it('generates IDs with the correct prefix', () => {
    const next = makeIdFactory('user');
    expect(next()).toBe('user-0001');
  });

  it('increments monotonically', () => {
    const next = makeIdFactory('tenant');
    expect(next()).toBe('tenant-0001');
    expect(next()).toBe('tenant-0002');
    expect(next()).toBe('tenant-0003');
  });

  it('pads counter to 4 digits', () => {
    const next = makeIdFactory('role');
    for (let i = 0; i < 9; i++) next();
    expect(next()).toBe('role-0010');
  });

  it('each factory instance is independent', () => {
    const nextUser = makeIdFactory('user');
    const nextTenant = makeIdFactory('tenant');
    expect(nextUser()).toBe('user-0001');
    expect(nextTenant()).toBe('tenant-0001');
    expect(nextUser()).toBe('user-0002');
    expect(nextTenant()).toBe('tenant-0002');
  });

  it('handles a large counter without truncation', () => {
    const next = makeIdFactory('audit');
    for (let i = 0; i < 9999; i++) next();
    expect(next()).toBe('audit-10000');
  });
});

describe('resetFactory', () => {
  it('returns a new factory starting from 0001', () => {
    const first = resetFactory('key');
    first(); // 'key-0001'
    first(); // 'key-0002'

    const fresh = resetFactory('key');
    expect(fresh()).toBe('key-0001');
  });
});
