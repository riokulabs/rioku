import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { z } from 'zod'
import { useFieldValidation } from '../use-field-validation'

const testSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
})

describe('useFieldValidation', () => {
  it('returns empty errors initially', () => {
    const { result } = renderHook(() =>
      useFieldValidation(testSchema, { name: '', email: '' }),
    )
    expect(result.current.errors).toEqual({})
  })

  it('validateAll returns errors for invalid fields', () => {
    const { result } = renderHook(() =>
      useFieldValidation(testSchema, { name: '', email: 'notanemail' }),
    )

    let valid = false
    act(() => {
      valid = result.current.validateAll()
    })

    expect(valid).toBe(false)
    expect(result.current.errors.name).toBe('Name is required')
    expect(result.current.errors.email).toBe('Invalid email')
  })

  it('validateAll returns true for valid values', () => {
    const { result } = renderHook(() =>
      useFieldValidation(testSchema, { name: 'test', email: 'test@example.com' }),
    )

    let valid = false
    act(() => {
      valid = result.current.validateAll()
    })

    expect(valid).toBe(true)
    expect(result.current.errors).toEqual({})
  })

  it('validateField validates single field', () => {
    const { result } = renderHook(() =>
      useFieldValidation(testSchema, { name: '', email: 'valid@test.com' }),
    )

    act(() => {
      result.current.validateField('name')
    })

    expect(result.current.errors.name).toBe('Name is required')
    expect(result.current.errors.email).toBeUndefined()
  })

  it('validateField clears error when field becomes valid', () => {
    const values = { name: '', email: 'valid@test.com' }
    const { result, rerender } = renderHook(
      ({ vals }) => useFieldValidation(testSchema, vals),
      { initialProps: { vals: values } },
    )

    act(() => {
      result.current.validateField('name')
    })
    expect(result.current.errors.name).toBe('Name is required')

    // Update values and revalidate
    rerender({ vals: { name: 'filled', email: 'valid@test.com' } })

    act(() => {
      result.current.validateField('name')
    })
    expect(result.current.errors.name).toBeUndefined()
  })

  it('clearError removes single error', () => {
    const { result } = renderHook(() =>
      useFieldValidation(testSchema, { name: '', email: 'bad' }),
    )

    act(() => {
      result.current.validateAll()
    })
    expect(Object.keys(result.current.errors).length).toBeGreaterThan(0)

    act(() => {
      result.current.clearError('name')
    })
    expect(result.current.errors.name).toBeUndefined()
    expect(result.current.errors.email).toBeDefined()
  })

  it('clearAll removes all errors', () => {
    const { result } = renderHook(() =>
      useFieldValidation(testSchema, { name: '', email: 'bad' }),
    )

    act(() => {
      result.current.validateAll()
    })
    expect(Object.keys(result.current.errors).length).toBeGreaterThan(0)

    act(() => {
      result.current.clearAll()
    })
    expect(result.current.errors).toEqual({})
  })

  it('getFieldProps returns aria attributes for invalid field', () => {
    const { result } = renderHook(() =>
      useFieldValidation(testSchema, { name: '', email: 'valid@test.com' }),
    )

    act(() => {
      result.current.validateAll()
    })

    const props = result.current.getFieldProps('name')
    expect(props['aria-invalid']).toBe(true)
    expect(props['aria-describedby']).toBe('error-name')
  })

  it('getFieldProps returns empty object for valid field', () => {
    const { result } = renderHook(() =>
      useFieldValidation(testSchema, { name: 'ok', email: 'valid@test.com' }),
    )

    const props = result.current.getFieldProps('name')
    expect(props['aria-invalid']).toBeUndefined()
  })
})
