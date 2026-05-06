/**
 * Stage-2 stub smoke test for access-policies API.
 *
 * Plan-03 Task 6 cannot wire to a real Orval client because the daemon does
 * not expose access policies in the OpenAPI spec (see decisions-needed.md
 * Items 002 + 004; the latter covers the cel-go test endpoint). The stage-2
 * module therefore re-exports the stage-1 mock-backed implementation.
 */
import { describe, it, expect } from 'vitest';

import * as stage2 from '../api.stage2';
import * as stage1 from '../api';

describe('access-policies api.stage2 stub re-exports stage1 surface', () => {
  it('exports the same useAccessPolicyList reference', () => {
    expect(stage2.useAccessPolicyList).toBe(stage1.useAccessPolicyList);
  });

  it('exports the same useAccessPolicy reference', () => {
    expect(stage2.useAccessPolicy).toBe(stage1.useAccessPolicy);
  });

  it('exports the same createAccessPolicyMutation reference', () => {
    expect(stage2.createAccessPolicyMutation).toBe(stage1.createAccessPolicyMutation);
  });

  it('exports the same updateAccessPolicyMutation reference', () => {
    expect(stage2.updateAccessPolicyMutation).toBe(stage1.updateAccessPolicyMutation);
  });

  it('exports the same deleteAccessPolicyMutation reference', () => {
    expect(stage2.deleteAccessPolicyMutation).toBe(stage1.deleteAccessPolicyMutation);
  });
});
