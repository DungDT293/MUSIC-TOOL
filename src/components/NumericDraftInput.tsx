import { useEffect, useState, type FocusEvent, type InputHTMLAttributes } from 'react'

type NumericDraftInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> & {
  value: number | '' | null | undefined
  onCommit: (value: number | '') => void
  integer?: boolean
  min?: number
  max?: number
  fallback?: number
  allowBlank?: boolean
  commitOnValidChange?: boolean
}

function formatValue(value: number | '' | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function parseCompleteNumber(raw: string, integer: boolean): number | null {
  const value = raw.trim()
  if (!value || value === '-' || value === '.' || value === '-.') return null
  if (integer && !/^-?\d+$/.test(value)) return null
  if (!integer && !/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value: number, min?: number, max?: number): number {
  let next = value
  if (typeof min === 'number') next = Math.max(min, next)
  if (typeof max === 'number') next = Math.min(max, next)
  return next
}

export default function NumericDraftInput({
  value,
  onCommit,
  integer = false,
  min,
  max,
  fallback,
  allowBlank = false,
  commitOnValidChange = true,
  onBlur,
  ...rest
}: NumericDraftInputProps) {
  const [draft, setDraft] = useState(formatValue(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(formatValue(value))
  }, [focused, value])

  const commitIfValid = (raw: string) => {
    if (raw === '') {
      if (allowBlank) onCommit('')
      return
    }

    const parsed = parseCompleteNumber(raw, integer)
    if (parsed === null) return
    if (typeof min === 'number' && parsed < min) return
    if (typeof max === 'number' && parsed > max) return
    onCommit(parsed)
  }

  const finishEditing = (event: FocusEvent<HTMLInputElement>) => {
    setFocused(false)

    const raw = draft.trim()
    if (raw === '') {
      if (allowBlank) {
        onCommit('')
        setDraft('')
      } else {
        const restored = typeof value === 'number' && Number.isFinite(value) ? value : fallback
        if (typeof restored === 'number') {
          onCommit(restored)
          setDraft(String(restored))
        } else {
          setDraft('')
        }
      }
      onBlur?.(event)
      return
    }

    const parsed = parseCompleteNumber(raw, integer)
    if (parsed === null) {
      setDraft(formatValue(value))
      onBlur?.(event)
      return
    }

    const next = clamp(parsed, min, max)
    onCommit(next)
    setDraft(String(next))
    onBlur?.(event)
  }

  return (
    <input
      {...rest}
      type="number"
      value={draft}
      min={min}
      max={max}
      step={rest.step ?? (integer ? 1 : undefined)}
      onFocus={(event) => {
        setFocused(true)
        rest.onFocus?.(event)
      }}
      onChange={(event) => {
        const raw = event.target.value
        setDraft(raw)
        if (commitOnValidChange) commitIfValid(raw)
      }}
      onBlur={finishEditing}
    />
  )
}
