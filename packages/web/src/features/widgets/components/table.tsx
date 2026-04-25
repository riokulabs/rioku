/**
 * <TableWidget> — tabular rows with inferred columns.
 *
 * Polished for dashboard contexts: hairline row separators (no zebra),
 * monospace numeric columns, sticky header with subtle shadow on scroll,
 * compact density, and per-row hover highlight. Numeric values right-align
 * automatically; string values left-align.
 *
 * Expected data shape: { rows: Record<string, unknown>[]; columns?: string[] }.
 */
import { Alert, Box, ScrollArea, Skeleton, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface TableData {
  rows: Record<string, unknown>[];
  columns?: string[];
}

function isTableData(data: unknown): data is TableData {
  return (
    typeof data === 'object' && data !== null && Array.isArray((data as { rows?: unknown }).rows)
  );
}

function inferAlignment(rows: Record<string, unknown>[], col: string): 'left' | 'right' {
  // If at least 75% of populated cells are numeric, right-align.
  let numeric = 0;
  let populated = 0;
  for (const r of rows) {
    const v = r[col];
    if (v === undefined || v === null || v === '') continue;
    populated++;
    if (typeof v === 'number') numeric++;
  }
  if (populated === 0) return 'left';
  return numeric / populated >= 0.75 ? 'right' : 'left';
}

function renderCell(value: unknown): { text: string; numeric: boolean } {
  if (typeof value === 'number') {
    return { text: value.toLocaleString(), numeric: true };
  }
  if (typeof value === 'string') return { text: value, numeric: false };
  if (typeof value === 'boolean') return { text: value ? 'true' : 'false', numeric: false };
  if (value === null || value === undefined) return { text: '—', numeric: false };
  return { text: JSON.stringify(value), numeric: false };
}

export function TableWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={180} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isTableData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ rows: [] }'}
      </Alert>
    );

  const columns = data.columns ?? (data.rows.length > 0 ? Object.keys(data.rows[0] ?? {}) : []);
  if (columns.length === 0 || data.rows.length === 0) {
    return (
      <Box p="md">
        <Text size="sm" c="dimmed" ta="center">
          No rows in this range.
        </Text>
      </Box>
    );
  }

  const alignments = Object.fromEntries(columns.map((c) => [c, inferAlignment(data.rows, c)])) as Record<string, 'left' | 'right'>;

  return (
    <ScrollArea
      h="100%"
      type="hover"
      offsetScrollbars
      aria-label={`Table for ${widget.title}`}
      styles={{
        viewport: { minHeight: 0 },
      }}
    >
      <Box
        component="table"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
        }}
      >
        <thead
          style={{
            position: 'sticky',
            top: 0,
            background: 'var(--mantine-color-body)',
            zIndex: 1,
          }}
        >
          <tr>
            {columns.map((c) => (
              <Box
                key={c}
                component="th"
                style={{
                  textAlign: alignments[c] === 'right' ? 'right' : 'left',
                  padding: '6px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--mantine-color-dimmed)',
                  borderBottom: '1px solid var(--mantine-color-default-border)',
                  whiteSpace: 'nowrap',
                }}
              >
                {c}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, ri) => (
            <Box
              key={ri}
              component="tr"
              style={{
                borderBottom:
                  ri === data.rows.length - 1
                    ? 'none'
                    : '1px solid var(--mantine-color-default-border)',
                transition: 'background 80ms linear',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--mantine-color-default-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {columns.map((c) => {
                const align = alignments[c] ?? 'left';
                const { text, numeric } = renderCell(row[c]);
                return (
                  <Box
                    key={c}
                    component="td"
                    style={{
                      textAlign: align === 'right' ? 'right' : 'left',
                      padding: '6px 10px',
                      whiteSpace: 'nowrap',
                      fontFamily: numeric || align === 'right' ? 'var(--mantine-font-family-monospace)' : undefined,
                      fontVariantNumeric: numeric ? 'tabular-nums' : undefined,
                      color: text === '—' ? 'var(--mantine-color-dimmed)' : undefined,
                    }}
                  >
                    {text}
                  </Box>
                );
              })}
            </Box>
          ))}
        </tbody>
      </Box>
    </ScrollArea>
  );
}
