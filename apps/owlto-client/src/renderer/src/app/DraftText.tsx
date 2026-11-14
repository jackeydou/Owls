import { useEffect, useState } from 'react'

/**
 * A text field that saves when it loses focus, so typing never writes on every key.
 * An `input` with `single`, otherwise a textarea.
 */
export function DraftText({
  id,
  value,
  onCommit,
  single = false,
  required = false,
  maxLength,
  placeholder,
  className,
  ...aria
}: {
  id?: string
  value: string
  onCommit: (value: string) => void
  single?: boolean
  required?: boolean
  maxLength: number
  placeholder?: string
  className?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}) {
  const [draft, setDraft] = useState(value)
  // A save elsewhere, or another project, replaces what is shown.
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = single ? draft.trim() : draft
    if (required && !next) {
      setDraft(value)
      return
    }
    if (next !== value) onCommit(next)
  }
  const shared = {
    id,
    value: draft,
    maxLength,
    placeholder,
    className,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit,
    ...aria
  }
  return single ? (
    <input
      {...shared}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(value)
      }}
    />
  ) : (
    <textarea {...shared} rows={5} />
  )
}
