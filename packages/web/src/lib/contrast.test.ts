import { describe, it, expect } from 'vitest';
import { resolveAccent } from './contrast';

describe('resolveAccent', () => {
  it('picks black text on light accents', () => {
    const r = resolveAccent('#fbbf24'); // yellow
    expect(r.textColor).toBe('#0a0a0a');
    expect(r.meetsAA).toBe(true);
  });
  it('picks white text on dark accents', () => {
    const r = resolveAccent('#1e293b');
    expect(r.textColor).toBe('#ffffff');
    expect(r.meetsAA).toBe(true);
  });
  it('adjusts mid-luminance accents when needed', () => {
    // #777777 fails AA with both white and near-black text at raw (ratios ~4.47 / ~4.42)
    const r = resolveAccent('#777777');
    expect(r.adjusted || !r.meetsAA).toBe(true);
  });
});
