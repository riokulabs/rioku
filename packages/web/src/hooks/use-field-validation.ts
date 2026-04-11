import { useState, useCallback, useRef } from 'react'
import type { ZodType, ZodError } from 'zod'

export interface UseFieldValidationReturn {
  errors: Record<string, string>
  validateField: (path: string) => void
  validateAll: () => boolean
  clearError: (path: string) => void
  clearAll: () => void
  getFieldProps: (path: string) => {
    'aria-invalid'?: boolean
    'aria-describedby'?: string
  }
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function useFieldValidation(
  schema: ZodType,
  values: unknown,
): UseFieldValidationReturn {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const valuesRef = useRef(values)
  valuesRef.current = values

  const validateField = useCallback(
    (path: string) => {
      // Validate the full object and extract errors for this field
      const result = schema.safeParse(valuesRef.current)
      if (result.success) {
        setErrors((prev) => {
          const next = { ...prev }
          delete next[path]
          return next
        })
      } else {
        const fieldError = (result.error as ZodError).issues.find(
          (issue) => issue.path.join('.') === path,
        )
        setErrors((prev) => {
          const next = { ...prev }
          if (fieldError) {
            next[path] = fieldError.message
          } else {
            delete next[path]
          }
          return next
        })
      }
    },
    [schema],
  )

  const validateAll = useCallback((): boolean => {
    const result = schema.safeParse(valuesRef.current)
    if (result.success) {
      setErrors({})
      return true
    }
    const fieldErrors: Record<string, string> = {}
    for (const issue of (result.error as ZodError).issues) {
      const key = issue.path.join('.')
      if (!fieldErrors[key]) {
        fieldErrors[key] = issue.message
      }
    }
    setErrors(fieldErrors)

    // Focus first invalid field
    const firstPath = Object.keys(fieldErrors)[0]
    if (firstPath) {
      const el = document.querySelector(`[name="${firstPath}"], [id="${firstPath}"]`)
      if (el && 'focus' in el) {
        ;(el as HTMLElement).focus()
      }
    }

    return false
  }, [schema])

  const clearError = useCallback((path: string) => {
    setErrors((prev) => {
      const next = { ...prev }
      delete next[path]
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setErrors({})
  }, [])

  const getFieldProps = useCallback(
    (path: string) => {
      const hasError = Boolean(errors[path])
      return {
        ...(hasError ? { 'aria-invalid': true } : {}),
        ...(hasError ? { 'aria-describedby': `error-${path}` } : {}),
      }
    },
    [errors],
  )

  return { errors, validateField, validateAll, clearError, clearAll, getFieldProps }
}
