import { type ReactNode } from 'react'

interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
}

interface DataTableProps<T> {
  title?: string
  columns: Column<T>[]
  data: T[]
  actions?: ReactNode
}

export function DataTable<T extends Record<string, unknown>>({
  title,
  columns,
  data,
  actions,
}: DataTableProps<T>) {
  return (
    <div className="table-container">
      {title && (
        <div className="table-header">
          <h3>{title}</h3>
          {actions}
        </div>
      )}
      <div className="table-responsive">
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key}>{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key}>
                    {col.render
                      ? col.render(row)
                      : String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
