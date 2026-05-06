/**
 * Stage-2 stub smoke test for middlewares API.
 *
 * Plan-03 Task 4 cannot wire to a real Orval client because the daemon does
 * not expose middlewares in the OpenAPI spec (see decisions-needed.md
 * Item 002). The stage-2 module therefore re-exports the stage-1 mock-backed
 * implementation. This test asserts that contract so a future regression
 * (e.g. a half-implemented Orval wiring that drops one of the exports)
 * is caught at CI time.
 */
import { describe, it, expect } from 'vitest';

import * as stage2 from '../api.stage2';
import * as stage1 from '../api';

describe('middlewares api.stage2 stub re-exports stage1 surface', () => {
  it('exports the same useMiddlewareList reference', () => {
    expect(stage2.useMiddlewareList).toBe(stage1.useMiddlewareList);
  });

  it('exports the same useMiddlewareDetail reference', () => {
    expect(stage2.useMiddlewareDetail).toBe(stage1.useMiddlewareDetail);
  });

  it('exports the same createMiddleware reference', () => {
    expect(stage2.createMiddleware).toBe(stage1.createMiddleware);
  });

  it('exports the same updateMiddleware reference', () => {
    expect(stage2.updateMiddleware).toBe(stage1.updateMiddleware);
  });

  it('exports the same deleteMiddleware reference', () => {
    expect(stage2.deleteMiddleware).toBe(stage1.deleteMiddleware);
  });
});
