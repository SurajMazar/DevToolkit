import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/utils/cn'

/**
 * Numeric input that lets the user type freely (including temporarily invalid text),
 * commits only valid in-range values, flags out-of-range values, and clamps on blur.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  integer = true,
  className,
  id,
  'aria-label': ariaLabel,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  integer?: boolean
  className?: string
  id?: string
  'aria-label'?: string
  suffix?: React.ReactNode
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)))
  }, [value])
  const parsed = text.trim() === '' ? NaN : Number(text)
  const valid = Number.isFinite(parsed) && (!integer || Number.isInteger(parsed)) && parsed >= min && parsed <= max
  const commit = (raw: string) => {
    setText(raw)
    const n = raw.trim() === '' ? NaN : Number(raw)
    if (Number.isFinite(n) && (!integer || Number.isInteger(n)) && n >= min && n <= max) onChange(n)
  }
  const input = (
    <Input
      id={id}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      aria-label={ariaLabel}
      aria-invalid={!valid}
      title={valid ? undefined : `Enter ${integer ? 'a whole number' : 'a number'} from ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}`}
      value={text}
      onChange={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const base = Number.isFinite(parsed) ? parsed : value
          const next = Math.min(max, Math.max(min, base + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)))
          const rounded = integer ? Math.round(next) : Math.round(next * 1e6) / 1e6
          setText(String(rounded))
          onChange(rounded)
        }
      }}
      onBlur={() => {
        if (!valid) {
          const n = Number.isFinite(parsed) ? Math.min(max, Math.max(min, integer ? Math.round(parsed) : parsed)) : value
          setText(String(n))
          onChange(n)
        }
      }}
      className={cn('tabular h-7 text-right', suffix ? 'pr-8' : '', className)}
    />
  )
  if (!suffix) return input
  return (
    <div className="relative">
      {input}
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-2xs text-subtle">{suffix}</span>
    </div>
  )
}
