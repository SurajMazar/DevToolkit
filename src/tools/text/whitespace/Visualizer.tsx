import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { EOL_CODES, tokenizeLine, type CharKind, type EolKind, type LineIndex, type LineToken } from '@/engines/text-utils/whitespace'
import { formatNumber } from '@/utils/format'
import { cn } from '@/utils/cn'

export const ROW_HEIGHT = 20
const MAX_RENDER_CHARS = 4000

export interface VisualizerHandle {
  scrollToLine: (line: number) => void
}

/** Tone classes per invisible kind (tokens only). */
export const KIND_CHIP: Record<CharKind, string> = {
  space: 'text-subtle',
  tab: 'text-subtle',
  nbsp: 'bg-warn-soft text-warn',
  'zero-width': 'bg-danger-soft text-danger',
  'unicode-space': 'bg-warn-soft text-warn',
  format: 'bg-mod-bg text-mod',
  control: 'bg-danger-soft text-danger',
  'line-separator': 'bg-accent-soft text-accent-text',
}

export const EOL_GLYPH: Record<EolKind, string> = { LF: '↵', CRLF: '␍↵', CR: '␍' }

function Chip({ kind, children, title }: { kind: CharKind; children: React.ReactNode; title: string }) {
  return (
    <span
      title={title}
      className={cn('mx-px inline-flex h-[15px] items-center rounded-[3px] px-[3px] align-[1px] font-sans text-[9.5px] font-semibold leading-none tracking-wide', KIND_CHIP[kind])}
    >
      {children}
    </span>
  )
}

function renderToken(tok: LineToken, i: number, showSpaces: boolean) {
  switch (tok.t) {
    case 'text':
      return <span key={i}>{tok.v}</span>
    case 'space':
      return (
        <span key={i} className={cn(tok.trailing ? 'bg-del-bg text-del' : 'text-subtle/70')} title={tok.trailing ? 'Trailing space' : undefined}>
          {showSpaces || tok.trailing ? '·'.repeat(tok.n) : ' '.repeat(tok.n)}
        </span>
      )
    case 'tab':
      return (
        <span
          key={i}
          title={tok.trailing ? 'Trailing tab' : 'Tab'}
          className={cn('inline-block text-left', tok.trailing ? 'bg-del-bg text-del' : 'text-subtle/80')}
          style={{ width: `${tok.width}ch` }}
        >
          →
        </span>
      )
    case 'special': {
      const { info, cp, trailing } = tok
      const title = `${info.name} (U+${cp.toString(16).toUpperCase().padStart(4, '0')})${trailing ? ' — trailing' : ''}`
      if (info.kind === 'nbsp') {
        return (
          <span key={i} title={title} className={cn('rounded-[2px]', trailing ? 'bg-del-bg text-del' : KIND_CHIP.nbsp)}>
            ⍽
          </span>
        )
      }
      return (
        <Chip key={i} kind={info.kind} title={title}>
          {info.abbr}
        </Chip>
      )
    }
  }
}

interface VisualizerProps {
  text: string
  index: LineIndex
  tabSize: number
  showSpaces: boolean
  dominantEol: EolKind | null
  mixedEol: boolean
  flashLine: number | null
  longestLine: number
  ariaLabel: string
}

/** Virtualized, read-only rendering of text with visible whitespace and invisible characters. */
export const Visualizer = forwardRef<VisualizerHandle, VisualizerProps>(function Visualizer(
  { text, index, tabSize, showSpaces, dominantEol, mixedEol, flashLine, longestLine, ariaLabel },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: index.count,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  useImperativeHandle(ref, () => ({
    scrollToLine: (line: number) => virtualizer.scrollToIndex(Math.max(0, Math.min(index.count - 1, line - 1)), { align: 'center' }),
  }))

  const gutterCh = Math.max(3, String(index.count).length)
  const minWidth = useMemo(() => `calc(${Math.min(longestLine, MAX_RENDER_CHARS) + gutterCh + 8}ch + 32px)`, [longestLine, gutterCh])

  return (
    <div
      ref={scroller}
      tabIndex={0}
      role="region"
      aria-label={ariaLabel}
      className="mono relative h-full min-h-0 overflow-auto bg-workspace text-[13px] leading-5 text-fg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <div style={{ height: virtualizer.getTotalSize(), minWidth }} className="relative">
        {virtualizer.getVirtualItems().map((row) => {
          const li = row.index
          const start = index.starts[li]
          const end = index.ends[li]
          const line = text.slice(start, end)
          const { tokens, truncated } = tokenizeLine(line, tabSize, MAX_RENDER_CHARS)
          const eol = EOL_CODES[index.eols[li]]
          const offEol = mixedEol && eol && eol !== dominantEol
          return (
            <div
              key={row.key}
              className={cn('absolute left-0 flex w-full whitespace-pre pr-6', flashLine === li + 1 && 'bg-accent-soft')}
              style={{ height: ROW_HEIGHT, transform: `translateY(${row.start}px)` }}
            >
              <span className="sticky left-0 z-[1] shrink-0 select-none border-r border-border bg-workspace pr-2 text-right text-subtle tabular" style={{ width: `${gutterCh + 2}ch` }} aria-hidden>
                {li + 1}
              </span>
              <span className="pl-3">
                {tokens.map((t, i) => renderToken(t, i, showSpaces))}
                {truncated > 0 && (
                  <span className="ml-2 rounded-sm bg-surface-2 px-1.5 font-sans text-2xs text-muted">… {formatNumber(truncated)} more characters not shown</span>
                )}
                {eol && (
                  <span
                    title={`${eol} line ending${offEol ? ` — differs from the dominant ${dominantEol}` : ''}`}
                    className={cn('ml-0.5 select-none', offEol ? 'rounded-[2px] bg-warn-soft px-0.5 text-warn' : 'text-subtle/70')}
                  >
                    {EOL_GLYPH[eol]}
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
})
