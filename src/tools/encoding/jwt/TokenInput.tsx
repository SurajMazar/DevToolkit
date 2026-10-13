import { useMemo, useRef } from 'react'
import type { SegmentRange } from '@/engines/encoding/jwt'
import { cn } from '@/utils/cn'

/** Token segment colours (header · payload · signature, and the extra JWE parts). */
export const SEGMENT_CLASS: Record<SegmentRange['segment'], string> = {
  header: 'text-del',
  payload: 'text-accent-text',
  signature: 'text-mod',
  encryptedKey: 'text-mod',
  iv: 'text-muted',
  ciphertext: 'text-accent-text',
  tag: 'text-add',
}

const PREFIX = /^\s*(?:authorization\s*:\s*)?(?:(?:bearer|jwt|token)\s+)?["'`]?/i

interface Span {
  text: string
  cls: string
}

/**
 * Colours the raw input by segment. The token may be preceded by "Bearer " and contain
 * whitespace; the colouring follows the raw text so it lines up with the textarea.
 */
function colourise(raw: string, segments: SegmentRange['segment'][], errorOffset: number | null): Span[] {
  const prefix = PREFIX.exec(raw)?.[0].length ?? 0
  const spans: Span[] = []
  const push = (text: string, cls: string) => {
    const last = spans[spans.length - 1]
    if (last && last.cls === cls) last.text += text
    else spans.push({ text, cls })
  }
  if (prefix) push(raw.slice(0, prefix), 'text-subtle')
  let seg = 0
  let tokenIndex = 0
  for (let i = prefix; i < raw.length; i++) {
    const ch = raw[i]
    if (/\s/.test(ch)) {
      push(ch, '')
      continue
    }
    const isError = errorOffset !== null && tokenIndex === errorOffset
    if (ch === '.') {
      push(ch, isError ? 'bg-danger-soft text-danger' : 'text-subtle')
      seg++
    } else if (/["'`]/.test(ch) && i === raw.trimEnd().length - 1) push(ch, 'text-subtle')
    else push(ch, isError ? 'rounded-xs bg-danger-soft text-danger underline decoration-danger' : (SEGMENT_CLASS[segments[seg]] ?? 'text-fg'))
    tokenIndex++
  }
  // A trailing newline needs a character after it to occupy space in <pre>.
  if (raw.endsWith('\n')) push(' ', '')
  return spans
}

export function TokenInput({
  value,
  onChange,
  segments,
  errorOffset,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  segments: SegmentRange['segment'][]
  errorOffset: number | null
  placeholder: string
}) {
  const pre = useRef<HTMLPreElement>(null)
  const spans = useMemo(() => colourise(value, segments, errorOffset), [value, segments, errorOffset])
  const shared = 'mono absolute inset-0 m-0 whitespace-pre-wrap break-all px-3 py-2.5 text-[13px] leading-[21px] [scrollbar-gutter:stable] [overflow-wrap:anywhere]'
  return (
    <div className="relative min-h-0 flex-1">
      <pre ref={pre} aria-hidden className={cn(shared, 'pointer-events-none overflow-hidden text-fg')}>
        {spans.map((s, i) => (
          <span key={i} className={s.cls}>
            {s.text}
          </span>
        ))}
      </pre>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (pre.current) pre.current.scrollTop = e.currentTarget.scrollTop
        }}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        data-gramm="false"
        aria-label="Encoded token"
        placeholder={placeholder}
        className={cn(shared, 'resize-none overflow-y-auto bg-transparent text-transparent caret-[var(--fg)] outline-none placeholder:text-subtle selection:bg-accent/30 selection:text-transparent')}
      />
    </div>
  )
}
