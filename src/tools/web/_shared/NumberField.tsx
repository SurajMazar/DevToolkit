import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/utils/cn'

interface NumberFieldProps {
  /** Short visible label (e.g. "X", "Blur"); drag it horizontally to scrub the value. */
  label: React.ReactNode
  /** Accessible name when the visible label is terse. */
  ariaLabel?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  /** Decimal places kept when committing. */
  precision?: number
  unit?: string
  className?: string
  disabled?: boolean
  title?: string
}

const round = (n: number, p: number) => Number(n.toFixed(p))

/**
 * Inspector-style numeric field (like Figma's): label prefix you can drag to scrub,
 * ↑/↓ to step (Shift ×10, Alt ×0.1), Enter/blur to commit typed values.
 */
export function NumberField({ label, ariaLabel, value, onChange, min = -Infinity, max = Infinity, step = 1, precision = 2, unit, className, disabled, title }: NumberFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const scrub = useRef<{ x: number; start: number; moved: boolean } | null>(null)
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const commit = (n: number) => {
    if (!Number.isFinite(n)) return
    const v = round(clamp(n), precision)
    if (v !== value) onChange(v)
  }
  const display = draft ?? String(round(value, precision))

  useEffect(() => {
    setDraft(null)
  }, [value])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
      const base = draft !== null && Number.isFinite(Number(draft)) ? Number(draft) : value
      commit(base + (e.key === 'ArrowUp' ? 1 : -1) * step * mult)
      setDraft(null)
    } else if (e.key === 'Enter') {
      const n = evaluate(display)
      if (n !== null) commit(n)
      setDraft(null)
    } else if (e.key === 'Escape') {
      setDraft(null)
      ;(e.target as HTMLInputElement).blur()
    }
  }

  return (
    <div
      title={title}
      className={cn(
        'flex h-7 min-w-0 items-center rounded-md border border-border bg-workspace text-sm transition-[border-color,box-shadow] duration-120 hover:border-border-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <label
        htmlFor={id}
        className="flex h-full shrink-0 cursor-ew-resize select-none items-center pl-2 pr-1 text-xs text-subtle"
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          scrub.current = { x: e.clientX, start: value, moved: false }
        }}
        onPointerMove={(e) => {
          const s = scrub.current
          if (!s) return
          const dx = e.clientX - s.x
          if (Math.abs(dx) > 2) s.moved = true
          if (s.moved) commit(s.start + Math.round(dx / 2) * step * (e.shiftKey ? 10 : 1))
        }}
        onPointerUp={(e) => {
          const s = scrub.current
          scrub.current = null
          if (s && !s.moved) document.getElementById(id)?.focus()
          ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
        }}
      >
        {label}
      </label>
      <input
        id={id}
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        value={display}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => {
          if (draft !== null) {
            const n = evaluate(draft)
            if (n !== null) commit(n)
          }
          setDraft(null)
        }}
        onKeyDown={onKeyDown}
        className="tabular h-full w-full min-w-0 bg-transparent pr-1 text-right text-[13px] text-fg outline-none"
      />
      {unit && <span className="shrink-0 select-none pr-2 text-xs text-subtle">{unit}</span>}
    </div>
  )
}

/** Parses a typed number; also accepts simple arithmetic like `12*2` or `100/3` (no eval). */
function evaluate(s: string): number | null {
  const t = s.trim().replace(/,/g, '.').replace(/(px|%|deg|rem)$/i, '')
  if (t === '') return null
  const n = Number(t)
  if (Number.isFinite(n)) return n
  const m = /^(-?[\d.]+)\s*([+\-*/])\s*(-?[\d.]+)$/.exec(t)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[3])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  switch (m[2]) {
    case '+':
      return a + b
    case '-':
      return a - b
    case '*':
      return a * b
    case '/':
      return b === 0 ? null : a / b
  }
  return null
}
