/**
 * Stage-2 stub smoke test for sites API.
 *
 * Plan-03 Task 5 cannot wire to a real Orval client because the daemon does
 * not expose sites in the OpenAPI spec (see decisions-needed.md Item 002).
 * The stage-2 module therefore re-exports the stage-1 mock-backed
 * implementation. The domain-typed delete-confirm UI is delivered via the
 * existing `delete-site-modal` component (covered by
 * `delete-site-modal.test.tsx`).
 */
import { describe, it, expect } from 'vitest';

import * as stage2 from '../api.stage2';
import * as stage1 from '../api';

describe('sites api.stage2 stub re-exports stage1 surface', () => {
  it('exports the same useSiteList reference', () => {
    expect(stage2.useSiteList).toBe(stage1.useSiteList);
  });

  it('exports the same useSiteDetail reference', () => {
    expect(stage2.useSiteDetail).toBe(stage1.useSiteDetail);
  });

  it('exports the same createSite reference', () => {
    expect(stage2.createSite).toBe(stage1.createSite);
  });

  it('exports the same updateSite reference', () => {
    expect(stage2.updateSite).toBe(stage1.updateSite);
  });

  it('exports the same deleteSite reference', () => {
    expect(stage2.deleteSite).toBe(stage1.deleteSite);
  });
});
