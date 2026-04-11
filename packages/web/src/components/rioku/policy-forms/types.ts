export interface PolicyFormProps {
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  errors?: Record<string, string>
  readOnly?: boolean
}
