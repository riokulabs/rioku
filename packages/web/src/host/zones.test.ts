import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerZone,
  unregisterZone,
  getZoneContributions,
  listAllZones,
} from './zones';

// Helper: register and track ids for cleanup.
const registeredIds: string[] = [];

function reg(zone: string): string {
  const id = registerZone({
    zone,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    component: (() => null) as any,
    source: 'plugin',
    pluginName: 'test-plugin',
  });
  registeredIds.push(id);
  return id;
}

beforeEach(() => {
  while (registeredIds.length > 0) {
    const id = registeredIds.pop();
    if (id !== undefined) unregisterZone(id);
  }
});

describe('registerZone', () => {
  it('returns a unique id per registration', () => {
    const id1 = reg('zone.a');
    const id2 = reg('zone.a');
    expect(id1).not.toBe(id2);
  });
});

describe('getZoneContributions', () => {
  it('returns contributions for a specific zone', () => {
    reg('service.detail.header');
    reg('service.detail.header');
    reg('dashboard.toolbar');
    const contribs = getZoneContributions('service.detail.header');
    expect(contribs).toHaveLength(2);
    contribs.forEach((c) => { expect(c.zone).toBe('service.detail.header'); });
  });

  it('returns empty array for unknown zone', () => {
    expect(getZoneContributions('unknown.zone')).toEqual([]);
  });
});

describe('listAllZones', () => {
  it('returns deduplicated zone names', () => {
    reg('zone.alpha');
    reg('zone.alpha');
    reg('zone.beta');
    const zones = listAllZones();
    expect(zones).toContain('zone.alpha');
    expect(zones).toContain('zone.beta');
    expect(zones.filter((z) => z === 'zone.alpha')).toHaveLength(1);
  });
});

describe('unregisterZone', () => {
  it('removes the contribution by id', () => {
    const id = reg('test.zone');
    expect(getZoneContributions('test.zone')).toHaveLength(1);
    unregisterZone(id);
    const idx = registeredIds.indexOf(id);
    if (idx !== -1) registeredIds.splice(idx, 1);
    expect(getZoneContributions('test.zone')).toHaveLength(0);
  });

  it('no-ops for unknown id', () => {
    expect(() => { unregisterZone('nonexistent-id'); }).not.toThrow();
  });
});
