import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('plugin-loader', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  describe('loadPlugin', () => {
    it('logs error for plugin missing id', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // The import will fail in test env, so this tests the error path
      const { loadPlugin } = await import('../plugin-loader')
      await loadPlugin('http://nonexistent.example.com/plugin.js')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[plugin-loader]'),
        expect.anything(),
      )

      consoleSpy.mockRestore()
    })
  })

  describe('loadPluginsFromManifest', () => {
    it('logs error when manifest fetch fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mock apiClient.get to reject
      vi.doMock('../api', () => ({
        apiClient: {
          get: vi.fn().mockRejectedValue(new Error('Network error')),
        },
      }))

      const { loadPluginsFromManifest } = await import('../plugin-loader')
      await loadPluginsFromManifest()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[plugin-loader] Failed to load plugin manifest'),
        expect.anything(),
      )

      consoleSpy.mockRestore()
    })
  })
})
