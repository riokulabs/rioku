interface FieldErrorProps {
  message?: string
  id?: string
}

function FieldError({ message, id }: FieldErrorProps) {
  if (!message) return null

  return (
    <p
      role="alert"
      id={id}
      className="mt-1 text-xs text-destructive"
      data-testid="field-error"
    >
      {message}
    </p>
  )
}

export { FieldError }
export type { FieldErrorProps }
