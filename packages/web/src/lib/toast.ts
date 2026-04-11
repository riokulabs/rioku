import { toast } from 'sonner'

interface ToastAction {
  label: string
  onClick: () => void
}

interface BaseToastOptions {
  duration?: number
  action?: ToastAction
}

interface ErrorToastOptions extends BaseToastOptions {
  detail?: string
}

export const showToast = {
  success(message: string, options?: BaseToastOptions) {
    toast.success(message, {
      duration: options?.duration ?? 5000,
      action: options?.action,
    })
  },

  error(message: string, options?: ErrorToastOptions) {
    toast.error(
      options?.detail ? `${message}: ${options.detail}` : message,
      {
        duration: options?.duration ?? 7000,
        action: options?.action,
      },
    )
  },

  info(message: string, options?: BaseToastOptions) {
    toast.info(message, {
      duration: options?.duration ?? 4000,
      action: options?.action,
    })
  },
}
