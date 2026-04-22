import { describe, it, expect } from 'vitest';
import { checkAbiCompatibility, CURRENT_ABI_VERSION, MIN_SUPPORTED_ABI } from './abi';

describe('ABI constants', () => {
  it('CURRENT_ABI_VERSION is 1', () => {
    expect(CURRENT_ABI_VERSION).toBe(1);
  });

  it('MIN_SUPPORTED_ABI is 1', () => {
    expect(MIN_SUPPORTED_ABI).toBe(1);
  });
});

describe('checkAbiCompatibility', () => {
  it('returns compatible when plugin min=1 and host=1 (no max)', () => {
    const result = checkAbiCompatibility(1, undefined);
    expect(result.compatible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns compatible when plugin min=1, max=5, host=1', () => {
    const result = checkAbiCompatibility(1, 5);
    expect(result.compatible).toBe(true);
  });

  it('returns not compatible when plugin requires min ABI 2, host is 1', () => {
    const result = checkAbiCompatibility(2, undefined);
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/requires admin ABI >= 2/);
    expect(result.reason).toMatch(/host is 1/);
  });

  it('returns not compatible when plugin requires max ABI 0, host is 1', () => {
    const result = checkAbiCompatibility(0, 0);
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/requires admin ABI <= 0/);
    expect(result.reason).toMatch(/host is 1/);
  });

  it('returns compatible when plugin has no max version and minVersion matches', () => {
    const result = checkAbiCompatibility(1, undefined);
    expect(result.compatible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns compatible when plugin min=0, no max, host=1 (older plugin, wider range)', () => {
    const result = checkAbiCompatibility(0, undefined);
    expect(result.compatible).toBe(true);
  });

  it('returns not compatible when max < min (malformed range, max < host)', () => {
    // Even if min <= host, if max < host → not compatible
    const result = checkAbiCompatibility(1, 0);
    expect(result.compatible).toBe(false);
  });
});
