import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import type { ExplainNode } from '@/engines/dev/regex-explain'
import { cn } from '@/utils/cn'

export interface PatternInputHandle {
  focus: () => void
  select: (start: number, end: number) => void
}

const KIND_CLASS: Partial<Record<ExplainNode['kind'], string>> = {
  escape: 'text-add',
  unicodeProperty: 'text-add',
  charClass: 'text-mod',
  classItem: 'text-mod',
  any: 'text-accent-text',
  anchor: 'text-del',
  boundary: 'text-del',
  backreference: 'text-accent-text',
  error: 'text-danger underline decoration-wavy decoration-danger underline-offset-4',
}

const GROUP_CLASS = 'text-accent-text'
const QUANT_CLASS = 'text-del'

/** Per-character colour classes derived from the explain tree. */
function colorize(pattern: string, nodes: ExplainNode[]): string[] {
  const cls: string[] = new Array(pattern.length).fill('text-fg')
  const paint = (start: number, end: number, c: string) => {
    for (let i = Math.max(0, start); i < Math.min(end, pattern.length); i++) cls[i] = c
  }
  const walk = (n: ExplainNode) => {
    const qLen = n.quantifier?.text.length ?? 0
    const bodyEnd = n.end - qLen
    if (n.kind === 'group' || n.kind === 'lookaround' || (n.kind === 'error' && n.children && pattern[n.start] === '(')) {
      const firstChild = n.children?.[0]
      const openEnd = firstChild ? firstChild.start : pattern[bodyEnd - 1] === ')' ? bodyEnd - 1 : bodyEnd
      paint(n.start, openEnd, n.kind === 'error' ? KIND_CLASS.error! : GROUP_CLASS)
      n.children?.forEach(walk)
      if (pattern[bodyEnd - 1] === ')') paint(bodyEnd - 1, bodyEnd, GROUP_CLASS)
    } else if (n.kind === 'alternation') {
      n.children?.forEach((alt, i) => {
        if (i > 0) paint(alt.start - 1, alt.start, GROUP_CLASS)
        alt.children?.forEach(walk)
      })
    } else if (n.kind === 'charClass' || (n.kind === 'error' && pattern[n.start] === '[')) {
      paint(n.start, bodyEnd, n.kind === 'error' ? KIND_CLASS.error! : KIND_CLASS.charClass!)
      n.children?.forEach((c) => {
        if (c.kind === 'escape' || c.kind === 'unicodeProperty') paint(c.start, c.end, KIND_CLASS.escape!)
        else if (c.kind === 'charClass') walk(c)
      })
    } else {
      const c = KIND_CLASS[n.kind]
      if (c) paint(n.start, bodyEnd, c)
    }
    if (qLen) paint(bodyEnd, n.end, n.quantifier!.possessive ? KIND_CLASS.error! : QUANT_CLASS)
  }
  nodes.forEach(walk)
  return cls
}

interface PatternInputProps {
  value: string
  onChange: (v: string) => void
  onPasteLiteral?: (text: string) => boolean
  nodes: ExplainNode[]
  highlight?: { start: number; end: number } | null
  invalid?: boolean
  flags: string
  id?: string
}

/** Single-line regex input with syntax colouring (a mirror layer under a transparent input). */
export const PatternInput = forwardRef<PatternInputHandle, PatternInputProps>(function PatternInput({ value, onChange, onPasteLiteral, nodes, highlight, invalid, flags, id }, ref) {
  const input = useRef<HTMLInputElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    select: (s, e) => {
      input.current?.focus()
      input.current?.setSelectionRange(s, e)
      sync()
    },
  }))
  const sync = () => {
    if (mirror.current && input.current) mirror.current.scrollLeft = input.current.scrollLeft
  }
  useLayoutEffect(sync)

  const segments = useMemo(() => {
    const cls = colorize(value, nodes)
    const out: { text: string; cls: string; hl: boolean }[] = []
    for (let i = 0; i < value.length; i++) {
      const hl = !!highlight && i >= highlight.start && i < highlight.end
      const last = out[out.length - 1]
      if (last && last.cls === cls[i] && last.hl === hl) last.text += value[i]
      else out.push({ text: value[i], cls: cls[i], hl })
    }
    return out
  }, [value, nodes, highlight])

  return (
    <div
      className={cn(
        'flex h-9 min-w-0 flex-1 items-center rounded-md border bg-workspace transition-[border-color,box-shadow] duration-120 focus-within:ring-2',
        invalid ? 'border-danger focus-within:ring-danger-soft' : 'border-border hover:border-border-strong focus-within:border-accent focus-within:ring-accent-soft',
      )}
    >
      <span className="mono select-none pl-2.5 text-[14px] text-subtle" aria-hidden>
        /
      </span>
      <div className="relative min-w-0 flex-1 self-stretch">
        <div ref={mirror} aria-hidden className="mono pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-1 text-[14px] leading-[34px]">
          {segments.map((s, i) => (
            <span key={i} className={cn(s.cls, s.hl && 'rounded-[2px] bg-accent/25')}>
              {s.text}
            </span>
          ))}
          {/* Trailing space keeps the mirror scroll range in step with the input's caret padding. */}
          <span> </span>
        </div>
        <input
          ref={input}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={sync}
          onSelect={sync}
          onKeyUp={sync}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text')
            if (onPasteLiteral && t && !value && onPasteLiteral(t)) e.preventDefault()
          }}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-label="Regular expression pattern"
          aria-invalid={invalid}
          placeholder="Type a pattern, e.g. (?<year>\d{4})-(\d{2})"
          className="mono relative h-full w-full bg-transparent px-1 text-[14px] leading-[34px] text-transparent caret-fg outline-none placeholder:text-subtle selection:bg-accent/30 selection:text-transparent"
        />
      </div>
      <span className="mono shrink-0 select-none pr-2.5 text-[14px] text-subtle" aria-label={`Flags: ${flags || 'none'}`}>
        /<span className="text-accent-text">{flags}</span>
      </span>
    </div>
  )
})
