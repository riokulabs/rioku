import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiClient } from '../api'

describe('apiClient', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockFetchResponse(body: unknown, status = 200, ok = true) {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: () => Promise.resolve(body),
    })
  }

  describe('GET', () => {
    it('constructs correct URL and sends GET with credentials', async () => {
      mockFetchResponse({ data: 'test' })

      await apiClient.get('/health')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/health'),
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
          headers: expect.objectContaining({
            Accept: 'application/json',
          }),
        }),
      )
    })

    it('appends query parameters', async () => {
      mockFetchResponse({ data: 'test' })

      await apiClient.get('/audit', { actor: 'admin', limit: '10' })

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string
      expect(calledUrl).toContain('actor=admin')
      expect(calledUrl).toContain('limit=10')
    })

    it('returns parsed JSON body', async () => {
      const body = { routes: [], version: 1 }
      mockFetchResponse(body)

      const result = await apiClient.get('/config')
      expect(result).toEqual(body)
    })
  })

  describe('POST', () => {
    it('sends JSON body with Content-Type header', async () => {
      mockFetchResponse({ id: '123' }, 201, true)

      const payload = { name: 'test-route' }
      await apiClient.post('/routes', payload)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify(payload),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        }),
      )
    })

    it('sends POST without body when none provided', async () => {
      mockFetchResponse(undefined, 204, true)

      await apiClient.post('/auth/logout')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: undefined,
        }),
      )
    })
  })

  describe('PATCH', () => {
    it('sends PATCH request with body', async () => {
      mockFetchResponse({ id: '123', name: 'updated' })

      await apiClient.patch('/routes/123', { name: 'updated' })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  describe('PUT', () => {
    it('sends PUT request with body', async () => {
      mockFetchResponse({ id: '123' })

      await apiClient.put('/routes/123', { name: 'replaced' })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })

  describe('DELETE', () => {
    it('sends DELETE request without body', async () => {
      mockFetchResponse(undefined, 204, true)

      await apiClient.del('/routes/123')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'DELETE',
          body: undefined,
        }),
      )
    })
  })

  describe('error handling', () => {
    it('throws RFC 7807 error on non-OK response with parseable body', async () => {
      const errorBody = {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'Route not found',
        instance: '/routes/999',
      }
      mockFetchResponse(errorBody, 404, false)

      await expect(apiClient.get('/routes/999')).rejects.toEqual(errorBody)
    })

    it('throws synthetic error when response body is not parseable JSON', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      })

      await expect(apiClient.get('/broken')).rejects.toMatchObject({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
      })
    })

    it('returns undefined for 204 No Content', async () => {
      mockFetchResponse(undefined, 204, true)

      const result = await apiClient.del('/routes/123')
      expect(result).toBeUndefined()
    })
  })
})
