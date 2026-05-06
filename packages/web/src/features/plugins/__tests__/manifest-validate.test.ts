/**
 * Manifest validator API tests (Plan 09 T3 — daemon-backed).
 *
 * Covers the three required cases: valid manifest, missing field,
 * invalid kind. Uses MSW to intercept the POST to
 * /api/v1/t/{tenant}/plugins/manifest/validate.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { validateManifest } from '../manifest-validate';

describe('validateManifest', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it('returns valid=true for a well-formed manifest', async () => {
    server.use(
      http.post('/api/v1/t/acme/plugins/manifest/validate', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.id).toBe('com.example.ok');
        return HttpResponse.json({ valid: true, errors: [] });
      }),
    );

    const result = await validateManifest('acme', {
      id: 'com.example.ok',
      version: '1.0.0',
      kind: 'http',
      entrypoint: 'plugin.so',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns valid=false with a missing-field error', async () => {
    server.use(
      http.post('/api/v1/t/acme/plugins/manifest/validate', () =>
        HttpResponse.json({
          valid: false,
          errors: [{ path: 'version', message: 'required field "version" is missing' }],
        }),
      ),
    );

    const result = await validateManifest('acme', { id: 'com.example.no-version', kind: 'http' });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe('version');
  });

  it('returns valid=false with an invalid-kind error', async () => {
    server.use(
      http.post('/api/v1/t/acme/plugins/manifest/validate', () =>
        HttpResponse.json({
          valid: false,
          errors: [{ path: 'kind', message: 'kind must be one of: http, ai, plugin' }],
        }),
      ),
    );

    const result = await validateManifest('acme', {
      id: 'com.example.bad-kind',
      version: '1.0.0',
      kind: 'cosmic-ray',
      entrypoint: 'plugin.so',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe('kind');
    expect(result.errors[0]?.message).toContain('kind must be one of');
  });
});
