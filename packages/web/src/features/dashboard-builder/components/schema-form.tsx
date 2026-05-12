/**
 * <SchemaForm> — introspects a Zod object schema and renders Mantine inputs
 * for each property. Used by both the wizard and the advanced editor to
 * render per-widget config.
 *
 * Supported Zod types:
 *   - z.string()                              → TextInput
 *   - z.string().min(1)                       → TextInput (required)
 *   - z.number()                              → NumberInput
 *   - z.number().int().min(...).max(...)      → NumberInput (int + constraints)
 *   - z.boolean()                             → Switch
 *   - z.enum([...])                           → Select
 *   - z.array(z.string())                     → TagsInput
 *   - z.optional(inner)                       → inner type, not required
 *
 * Unsupported types fall back to a read-only JSON display with a warning.
 */
import {
  Alert,
  Code,
  NumberInput,
  Select,
  Stack,
  Switch,
  TagsInput,
  TextInput,
} from '@mantine/core';
import type { ReactNode } from 'react';
import type { z } from 'zod';

// ─── Public props ─────────────────────────────────────────────────────────────

export interface SchemaFormProps<T extends Record<string, unknown> = Record<string, unknown>> {
  /** A Zod object schema describing the shape of `value`. */
  schema: z.ZodObject<z.ZodRawShape>;
  /** Current values keyed by property name. */
  value: T;
  /** Emits the full updated value when any field changes. */
  onChange: (next: T) => void;
  /** Optional label lookup so we can show friendlier field names. */
  labels?: Record<string, string>;
}

// ─── Introspection helpers ────────────────────────────────────────────────────

interface IntrospectedField {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array-string' | 'unsupported';
  required: boolean;
  enumValues?: string[];
  min?: number;
  max?: number;
  int?: boolean;
  minStringLength?: number;
  rawTypeName: string;
}

/**
 * Minimal shape of a Zod v4 def that we read via introspection. Zod's public
 * types don't expose this surface, so we model only the fields we consume.
 */
interface ZodDefShape {
  type?: string;
  checks?: { _zod?: { def?: ZodCheckShape }; def?: ZodCheckShape }[];
  innerType?: { _zod?: { def?: ZodDefShape }; _def?: ZodDefShape };
  element?: { _zod?: { def?: ZodDefShape }; _def?: ZodDefShape };
  entries?: Record<string, string | number>;
}

interface ZodCheckShape {
  check?: string;
  value?: unknown;
  format?: string;
  minimum?: number;
}

interface ZodInternal {
  _zod?: { def?: ZodDefShape };
  _def?: ZodDefShape;
}

function readDef(node: unknown): ZodDefShape | undefined {
  const n = node as ZodInternal | null | undefined;
  return n?._zod?.def ?? n?._def;
}

/**
 * Introspect a Zod node using the v4 `_zod.def` shape. Unwraps `optional`
 * layers first so the UI knows the field isn't required.
 */
function introspect(node: z.ZodType): IntrospectedField {
  let required = true;
  let def: ZodDefShape | undefined = readDef(node);
  while (
    def !== undefined &&
    (def.type === 'optional' || def.type === 'default' || def.type === 'nullable')
  ) {
    required = false;
    const inner = readDef(def.innerType);
    if (!inner) break;
    def = inner;
  }

  if (!def) {
    return { type: 'unsupported', required, rawTypeName: 'unknown' };
  }

  const rawTypeName = def.type ?? 'unknown';

  if (def.type === 'string') {
    let minStringLength: number | undefined;
    for (const c of def.checks ?? []) {
      const cd = c._zod?.def ?? c.def;
      if (cd?.check === 'min_length' && typeof cd.minimum === 'number') {
        minStringLength = cd.minimum;
      }
    }
    return {
      type: 'string',
      required,
      rawTypeName,
      ...(minStringLength !== undefined ? { minStringLength } : {}),
    };
  }

  if (def.type === 'number') {
    let min: number | undefined;
    let max: number | undefined;
    let int = false;
    for (const c of def.checks ?? []) {
      const cd = c._zod?.def ?? c.def;
      if (cd?.check === 'number_format' && cd.format === 'safeint') int = true;
      if (cd?.check === 'greater_than' && typeof cd.value === 'number') min = cd.value;
      if (cd?.check === 'less_than' && typeof cd.value === 'number') max = cd.value;
    }
    return {
      type: 'number',
      required,
      rawTypeName,
      ...(int ? { int: true } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    };
  }

  if (def.type === 'boolean') {
    return { type: 'boolean', required, rawTypeName };
  }

  if (def.type === 'enum') {
    const values = Object.values(def.entries ?? {}).map(String);
    return { type: 'enum', required, rawTypeName, enumValues: values };
  }

  if (def.type === 'array') {
    const inner = readDef(def.element);
    if (inner?.type === 'string') {
      return { type: 'array-string', required, rawTypeName };
    }
  }

  return { type: 'unsupported', required, rawTypeName };
}

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Field renderer ───────────────────────────────────────────────────────────

function renderField(
  key: string,
  info: IntrospectedField,
  value: unknown,
  label: string,
  onChange: (next: unknown) => void,
): ReactNode {
  const requiredAsterisk = info.required ? ' *' : '';
  switch (info.type) {
    case 'string':
      return (
        <TextInput
          label={`${label}${requiredAsterisk}`}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => {
            onChange(e.currentTarget.value);
          }}
          required={info.required}
        />
      );
    case 'number':
      return (
        <NumberInput
          label={`${label}${requiredAsterisk}`}
          value={typeof value === 'number' ? value : ''}
          onChange={(v) => {
            onChange(
              typeof v === 'number'
                ? v
                : typeof v === 'string' && v.length > 0
                  ? Number(v)
                  : undefined,
            );
          }}
          {...(info.int ? { allowDecimal: false } : {})}
          {...(info.min !== undefined ? { min: info.min } : {})}
          {...(info.max !== undefined ? { max: info.max } : {})}
          required={info.required}
        />
      );
    case 'boolean':
      return (
        <Switch
          label={label}
          checked={Boolean(value)}
          onChange={(e) => {
            onChange(e.currentTarget.checked);
          }}
        />
      );
    case 'enum':
      return (
        <Select
          label={`${label}${requiredAsterisk}`}
          data={info.enumValues ?? []}
          value={typeof value === 'string' ? value : null}
          onChange={(v) => {
            onChange(v ?? '');
          }}
          required={info.required}
        />
      );
    case 'array-string':
      return (
        <TagsInput
          label={`${label}${requiredAsterisk}`}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(v) => {
            onChange(v);
          }}
        />
      );
    case 'unsupported':
    default:
      return (
        <Alert color="yellow" title={`${label}: unsupported schema type`} variant="light">
          Raw value: <Code>{JSON.stringify(value ?? null)}</Code>
          <br />
          Detected type: <Code>{info.rawTypeName}</Code>
        </Alert>
      );
  }
}

// ─── Public component ─────────────────────────────────────────────────────────

export function SchemaForm<T extends Record<string, unknown>>({
  schema,
  value,
  onChange,
  labels,
}: SchemaFormProps<T>) {
  const shape = schema.shape as Record<string, z.ZodType>;

  return (
    <Stack gap="sm" aria-label="Widget schema form">
      {Object.entries(shape).map(([key, node]) => {
        const info = introspect(node);
        const label = labels?.[key] ?? humanize(key);
        return (
          <div key={key}>
            {renderField(key, info, value[key], label, (next) => {
              onChange({ ...value, [key]: next });
            })}
          </div>
        );
      })}
    </Stack>
  );
}
