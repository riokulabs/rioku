import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToCsv, exportToJson } from '../export-utils'

describe('exportToCsv', () => {
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:test')
    revokeObjectURL = vi.fn()
    Object.defineProperty(globalThis, 'URL', {
      value: { createObjectURL, revokeObjectURL },
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates CSV with headers and rows', () => {
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]

    const result = exportToCsv(data, ['name', 'age'], 'test.csv')

    expect(result).toContain('name,age')
    expect(result).toContain('"Alice","30"')
    expect(result).toContain('"Bob","25"')
  })

  it('escapes double quotes in CSV values', () => {
    const data = [{ name: 'O"Brien', value: 'test' }]

    const result = exportToCsv(data, ['name', 'value'], 'test.csv')

    expect(result).toContain('"O""Brien"')
  })
})

describe('exportToJson', () => {
  it('generates pretty-printed JSON', () => {
    const data = [{ name: 'Alice' }]

    const result = exportToJson(data, 'test.json')

    expect(result).toBe(JSON.stringify(data, null, 2))
  })

  it('handles empty array', () => {
    const result = exportToJson([], 'test.json')

    expect(result).toBe('[]')
  })
})
