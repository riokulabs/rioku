import { describe, expect, it, vi, beforeEach } from 'vitest';
import { customFetch } from './mutator';
import { AuthFailureError, ServerError, ValidationError } from './errors';

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

describe('customFetch', () => {
  it('@read-only sends credentials: include', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await customFetch<{ ok: boolean }>({ url: '/api/v1/foo', method: 'GET' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe('include');
  });

  it('@read-only parses RFC-7807 problem on 422', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'Validation failed',
          status: 422,
          detail: 'name is required',
          fields: { name: ['required'] },
        }),
        { status: 422, headers: { 'content-type': 'application/problem+json' } },
      ),
    );
    await expect(
      customFetch({ url: '/api/v1/services', method: 'POST', data: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('@read-only throws AuthFailureError on 401', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 401 }));
    await expect(customFetch({ url: '/api/v1/foo', method: 'GET' })).rejects.toBeInstanceOf(
      AuthFailureError,
    );
  });

  it('@read-only throws ServerError on 500', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 500 }));
    await expect(customFetch({ url: '/api/v1/foo', method: 'GET' })).rejects.toBeInstanceOf(
      ServerError,
    );
  });

  it('@read-only captures correlation-id from response header', async () => {
    mockFetch.mockResolvedValue(
      new Response('', {
        status: 401,
        headers: { 'x-correlation-id': 'cid-abc' },
      }),
    );
    try {
      await customFetch({ url: '/api/v1/foo', method: 'GET' });
    } catch (err) {
      expect(err).toBeInstanceOf(AuthFailureError);
      expect((err as AuthFailureError).correlationId).toBe('cid-abc');
    }
  });

  it('@read-only returns parsed JSON body for 200', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: '1', name: 'svc' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await customFetch<{ id: string; name: string }>({
      url: '/api/v1/foo',
      method: 'GET',
    });
    expect(result).toEqual({ id: '1', name: 'svc' });
  });

  it('@read-only returns undefined for 204 No Content', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await customFetch({ url: '/api/v1/foo', method: 'DELETE' });
    expect(result).toBeUndefined();
  });

  it('@read-only sends JSON body and content-type for POST/PUT/PATCH', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await customFetch({
      url: '/api/v1/foo',
      method: 'POST',
      data: { name: 'svc' },
    });
    const init = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ name: 'svc' }));
  });
});
