/**
 * Plugin sideload API tests (Plan 09 T5).
 *
 * Covers the success path, the 501 stub-rejection path, and the
 * problem-detail unwrap so the form can render the daemon's
 * decisions-needed message inline.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { sideloadPlugin } from '../sideload';

function makeFile(name: string, content: string, type: string): File {
  return new File([content], name, { type });
}

describe('sideloadPlugin', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it('returns accepted=true with installId on 2xx', async () => {
    server.use(
      http.post('/api/v1/t/acme/plugins/sideload', () =>
        HttpResponse.json({ installId: 'install-123', status: 'queued' }, { status: 202 }),
      ),
    );

    const result = await sideloadPlugin({
      tenantSlug: 'acme',
      archive: makeFile('plugin.so', 'binary', 'application/octet-stream'),
      manifest: makeFile('rioku-plugin.json', '{}', 'application/json'),
    });

    expect(result.accepted).toBe(true);
    expect(result.installId).toBe('install-123');
    expect(result.status).toBe(202);
  });

  it('unwraps the daemon problem-detail title + detail on 501', async () => {
    server.use(
      http.post('/api/v1/t/acme/plugins/sideload', () =>
        HttpResponse.json(
          {
            type: 'https://rioku.dev/errors/internal',
            title: 'Plugin sideload not yet implemented',
            detail: 'Tracked by issues #142 and #146.',
          },
          { status: 501 },
        ),
      ),
    );

    const result = await sideloadPlugin({
      tenantSlug: 'acme',
      archive: makeFile('plugin.so', 'binary', 'application/octet-stream'),
      manifest: makeFile('rioku-plugin.json', '{}', 'application/json'),
    });

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(501);
    expect(result.errorTitle).toBe('Plugin sideload not yet implemented');
    expect(result.errorDetail).toContain('#142');
  });

  it('falls back to statusText when the body is not JSON', async () => {
    server.use(
      http.post('/api/v1/t/acme/plugins/sideload', () =>
        new HttpResponse('Bad Request', { status: 400, statusText: 'Bad Request' }),
      ),
    );

    const result = await sideloadPlugin({
      tenantSlug: 'acme',
      archive: makeFile('plugin.so', 'binary', 'application/octet-stream'),
      manifest: makeFile('rioku-plugin.json', '{}', 'application/json'),
    });

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(400);
    expect(result.errorTitle).toBe('Sideload failed');
  });
});
