import { useEffect, useState } from 'react'
import { formatHex, parse } from 'culori'
import { cn } from '@/utils/cn'
import { CHECKER } from './checker'

interface ColorFieldProps {
  /** Any CSS color string. */
  value: string
  onChange: (v: string) => void
  /** Accessible name, e.g. "Stop 2 color". */
  label: string
  className?: string
  /** Called with the parse error (or null) whenever the typed text changes validity. */
  onValidity?: (error: string | null) => void
  size?: 'sm' | 'md'
}

function pickerHex(v: string): string {
  const c = parse(v.trim())
  return (c && formatHex(c)) || '#000000'
}

/**
 * Swatch (opens the native color picker) + text input accepting any CSS color (via culori).
 * Invalid text is kept in the field and flagged, never silently replaced.
 */
export function ColorField({ value, onChange, label, className, onValidity, size = 'sm' }: ColorFieldProps) {
  const [draft, setDraft] = useState(value)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setDraft(value)
    setInvalid(false)
  }, [value])

  const setText = (text: string) => {
    setDraft(text)
    const ok = parse(text.trim()) !== undefined
    setInvalid(!ok)
    onValidity?.(ok ? null : `“${text}” is not a valid CSS color`)
    if (ok && text.trim() !== value) onChange(text.trim())
  }

  const alpha = parse(value.trim())?.alpha
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-workspace pl-1 transition-[border-color,box-shadow] duration-120 hover:border-border-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft',
        size === 'sm' ? 'h-7' : 'h-8',
        invalid && 'border-danger focus-within:border-danger focus-within:ring-danger-soft',
        className,
      )}
    >
      <label
        className={cn('relative shrink-0 cursor-pointer overflow-hidden rounded-[4px] border border-border-strong', size === 'sm' ? 'size-5' : 'size-6')}
        style={{ background: CHECKER }}
        title="Open color picker"
      >
        <span className="absolute inset-0" style={{ background: invalid ? 'transparent' : value }} />
        <input
          type="color"
          aria-label={`${label} — picker`}
          value={pickerHex(value)}
          onChange={(e) => {
            // The native picker has no alpha channel — keep the current alpha.
            const hex = e.target.value
            const next = alpha !== undefined && alpha < 1 ? hex + Math.round(alpha * 255).toString(16).padStart(2, '0') : hex
            setDraft(next)
            setInvalid(false)
            onValidity?.(null)
            onChange(next)
          }}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      <input
        aria-label={label}
        aria-invalid={invalid}
        spellCheck={false}
        autoComplete="off"
        value={draft}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (invalid) return
          setDraft(value)
        }}
        className="mono h-full min-w-0 flex-1 bg-transparent pr-2 text-[12.5px] text-fg outline-none"
      />
    </div>
  )
}
