import { test as base, expect } from '@playwright/test';

/** Test fixture with admin authentication pre-loaded. */
export const adminTest = base.extend({
  storageState: 'e2e/.auth/admin.json',
});

/** Test fixture with viewer authentication pre-loaded. */
export const viewerTest = base.extend({
  storageState: 'e2e/.auth/viewer.json',
});

/** Test fixture with operator authentication pre-loaded. */
export const operatorTest = base.extend({
  storageState: 'e2e/.auth/operator.json',
});

/** Unauthenticated test (no stored session). */
export const anonTest = base.extend({
  storageState: { cookies: [], origins: [] },
});

export { expect };
