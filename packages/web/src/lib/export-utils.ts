/**
 * Generate a CSV string from an array of objects and trigger a download.
 * Returns the CSV string for testing.
 */
export function exportToCsv<T extends Record<string, unknown>>(
  data: T[],
  columns: string[],
  filename: string,
): string {
  const escape = (val: unknown): string => {
    const str = String(val ?? '')
    return `"${str.replace(/"/g, '""')}"`
  }

  const rows = data.map((row) => columns.map((col) => escape(row[col])).join(','))
  const content = [columns.join(','), ...rows].join('\n')

  triggerDownload(content, 'text/csv', filename)
  return content
}

/**
 * Generate a pretty-printed JSON string and trigger a download.
 * Returns the JSON string for testing.
 */
export function exportToJson<T>(data: T[], filename: string): string {
  const content = JSON.stringify(data, null, 2)

  triggerDownload(content, 'application/json', filename)
  return content
}

function triggerDownload(content: string, mimeType: string, filename: string): void {
  if (typeof document === 'undefined') return

  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
