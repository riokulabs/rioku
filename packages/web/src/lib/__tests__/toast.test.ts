import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toast } from 'sonner'
import { showToast } from '../toast'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

describe('showToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('success', () => {
    it('calls toast.success with message and default duration', () => {
      showToast.success('Saved')

      expect(toast.success).toHaveBeenCalledWith('Saved', {
        duration: 5000,
        action: undefined,
      })
    })

    it('uses custom duration when provided', () => {
      showToast.success('Done', { duration: 3000 })

      expect(toast.success).toHaveBeenCalledWith('Done', {
        duration: 3000,
        action: undefined,
      })
    })

    it('passes action through when provided', () => {
      const action = { label: 'Undo', onClick: vi.fn() }
      showToast.success('Route created', { action })

      expect(toast.success).toHaveBeenCalledWith('Route created', {
        duration: 5000,
        action,
      })
    })

    it('passes both custom duration and action', () => {
      const action = { label: 'View', onClick: vi.fn() }
      showToast.success('Deployed', { duration: 2000, action })

      expect(toast.success).toHaveBeenCalledWith('Deployed', {
        duration: 2000,
        action,
      })
    })
  })

  describe('error', () => {
    it('calls toast.error with message and default duration', () => {
      showToast.error('Failed')

      expect(toast.error).toHaveBeenCalledWith('Failed', {
        duration: 7000,
        action: undefined,
      })
    })

    it('concatenates detail into message when provided', () => {
      showToast.error('Request failed', { detail: 'connection timeout' })

      expect(toast.error).toHaveBeenCalledWith(
        'Request failed: connection timeout',
        {
          duration: 7000,
          action: undefined,
        },
      )
    })

    it('uses message alone when detail is undefined', () => {
      showToast.error('Server error', { duration: 10000 })

      expect(toast.error).toHaveBeenCalledWith('Server error', {
        duration: 10000,
        action: undefined,
      })
    })

    it('uses custom duration when provided', () => {
      showToast.error('Timeout', { duration: 10000 })

      expect(toast.error).toHaveBeenCalledWith('Timeout', {
        duration: 10000,
        action: undefined,
      })
    })

    it('passes action through when provided', () => {
      const action = { label: 'Retry', onClick: vi.fn() }
      showToast.error('Save failed', { action })

      expect(toast.error).toHaveBeenCalledWith('Save failed', {
        duration: 7000,
        action,
      })
    })

    it('combines detail and action together', () => {
      const action = { label: 'Retry', onClick: vi.fn() }
      showToast.error('Upload failed', {
        detail: '413 Payload Too Large',
        action,
        duration: 9000,
      })

      expect(toast.error).toHaveBeenCalledWith(
        'Upload failed: 413 Payload Too Large',
        {
          duration: 9000,
          action,
        },
      )
    })
  })

  describe('info', () => {
    it('calls toast.info with message and default duration', () => {
      showToast.info('Syncing config')

      expect(toast.info).toHaveBeenCalledWith('Syncing config', {
        duration: 4000,
        action: undefined,
      })
    })

    it('uses custom duration when provided', () => {
      showToast.info('Loading', { duration: 2000 })

      expect(toast.info).toHaveBeenCalledWith('Loading', {
        duration: 2000,
        action: undefined,
      })
    })

    it('passes action through when provided', () => {
      const action = { label: 'Dismiss', onClick: vi.fn() }
      showToast.info('Update available', { action })

      expect(toast.info).toHaveBeenCalledWith('Update available', {
        duration: 4000,
        action,
      })
    })
  })

  describe('default durations', () => {
    it('success defaults to 5000ms', () => {
      showToast.success('ok')
      const opts = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(opts.duration).toBe(5000)
    })

    it('error defaults to 7000ms', () => {
      showToast.error('fail')
      const opts = (toast.error as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(opts.duration).toBe(7000)
    })

    it('info defaults to 4000ms', () => {
      showToast.info('note')
      const opts = (toast.info as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(opts.duration).toBe(4000)
    })
  })
})
