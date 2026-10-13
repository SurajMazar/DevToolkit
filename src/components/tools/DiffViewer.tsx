import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronsUpDown } from 'lucide-react'
import { RowKind, type TextDiffResult, type WhitespaceMode } from '@/engines/diff/text-diff'
import { inlineDiff, type InlineDiff, type InlineRange } from '@/engines/diff/inline'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

export type DiffLayout = 'split' | 'unified'
export type DiffGranularity = 'line' | 'word' | 'char'

export interface DiffViewerHandle {
  scrollToHunk: (index: number) => void
}

interface DiffViewerProps {
  linesA: string[]
  linesB: string[]
  result: TextDiffResult
  layout: DiffLayout
  granularity: DiffGranularity
  ignoreCase: boolean
  whitespace: WhitespaceMode
  wrap: boolean
  /** Collapse unchanged regions, keeping `context` lines around changes. */
  collapse: boolean
  context: number
  activeHunk: number
  search?: string
  labels?: [string, string]
  className?: string
}

const ROW_H = 20
const FONT = "12.5px 'Geist Mono Variable', ui-monospace, monospace"

interface Fold {
  start: number
  end: number
}

let charWidthCache = 0
function charWidth() {
  if (charWidthCache) return charWidthCache
  try {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = FONT
    charWidthCache = ctx.measureText('0000000000').width / 10 || 7.5
  } catch {
    charWidthCache = 7.5
  }
  return charWidthCache
}

function renderSegments(text: string, ranges: InlineRange[] | null, strongClass: string, search?: string) {
  // Merge inline-diff ranges and search hits into spans.
  type Mark = { start: number; end: number; cls: string }
  const marks: Mark[] = []
  if (ranges) for (const r of ranges) marks.push({ start: r.start, end: r.end, cls: strongClass })
  if (search) {
    const q = search.toLowerCase()
    const t = text.toLowerCase()
    let i = t.indexOf(q)
    let guard = 0
    while (i !== -1 && guard++ < 200) {
      marks.push({ start: i, end: i + q.length, cls: 'outline outline-1 outline-mod bg-mod-bg rounded-[2px]' })
      i = t.indexOf(q, i + q.length)
    }
  }
  if (!marks.length) return text || '​'
  marks.sort((a, b) => a.start - b.start)
  const out: React.ReactNode[] = []
  let pos = 0
  marks.forEach((m, k) => {
    const s = Math.max(m.start, pos)
    if (s > pos) out.push(text.slice(pos, s))
    if (m.end > s) out.push(<span key={k} className={m.cls}>{text.slice(s, m.end)}</span>)
    pos = Math.max(pos, m.end)
  })
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

const sideBg: Record<number, string> = {
  [RowKind.Removed]: 'bg-del-bg',
  [RowKind.Added]: 'bg-add-bg',
}

const markerFor = (kind: number, side: 'a' | 'b') => {
  if (kind === RowKind.Removed || (kind === RowKind.Modified && side === 'a')) return { ch: '−', cls: 'text-del' }
  if (kind === RowKind.Added || (kind === RowKind.Modified && side === 'b')) return { ch: '+', cls: 'text-add' }
  return { ch: '', cls: '' }
}

interface SideCellProps {
  lineNo: number
  text: string | null
  bg: string
  marker: { ch: string; cls: string }
  ranges: InlineRange[] | null
  strong: string
  wrap: boolean
  search?: string
  faded?: boolean
  side: 'a' | 'b'
}

const SideCell = memo(function SideCell({ lineNo, text, bg, marker, ranges, strong, wrap, search, faded, side }: SideCellProps) {
  if (text === null)
    return (
      <div className={cn('flex min-w-0 flex-1', `diff-side-${side}`)}>
        <div className="w-[52px] shrink-0 bg-surface/60" />
        <div className="min-w-0 flex-1 bg-[repeating-linear-gradient(135deg,transparent_0_5px,var(--border)_5px_6px)] opacity-40" />
      </div>
    )
  return (
    <div className={cn('flex min-w-0 flex-1', bg, `diff-side-${side}`)}>
      <div className="w-[40px] shrink-0 select-none pr-2 text-right text-subtle tabular">{lineNo}</div>
      <div className={cn('w-3 shrink-0 select-none text-center', marker.cls)}>{marker.ch}</div>
      <div className={cn('min-w-0 flex-1 overflow-hidden pr-3', faded && 'opacity-45')}>
        <div className={cn(wrap ? 'whitespace-pre-wrap break-all' : 'diff-scroll-x whitespace-pre')} style={{ tabSize: 4 }}>
          {renderSegments(text, ranges, strong, search)}
        </div>
      </div>
    </div>
  )
})

/**
 * Virtualized side-by-side / unified diff renderer. Handles millions of rows: only the
 * visible rows are rendered, and intra-line diffs are computed lazily per visible row.
 */
export const DiffViewer = forwardRef<DiffViewerHandle, DiffViewerProps>(function DiffViewer(
  { linesA, linesB, result, layout, granularity, ignoreCase, whitespace, wrap, collapse, context, activeHunk, search, labels = ['Original', 'Modified'], className },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const inlineCache = useRef(new Map<number, InlineDiff | null>())

  useEffect(() => {
    inlineCache.current.clear()
  }, [result, granularity, ignoreCase, whitespace, layout])
  useEffect(() => setExpanded(new Set()), [result, collapse, context, layout])

  const kinds = layout === 'split' ? result.kinds : result.uKinds
  const total = kinds.length

  // Build the display list: row indices, with negative entries for folded regions.
  const { display, folds } = useMemo(() => {
    if (!collapse || result.hunks.length === 0) {
      const d = new Int32Array(total)
      for (let i = 0; i < total; i++) d[i] = i
      return { display: d, folds: [] as Fold[] }
    }
    const keep = new Uint8Array(total)
    for (const h of result.hunks) {
      const s = layout === 'split' ? h.rowStart : h.uRowStart
      const e = layout === 'split' ? h.rowEnd : h.uRowEnd
      for (let i = Math.max(0, s - context); i < Math.min(total, e + context); i++) keep[i] = 1
    }
    const out: number[] = []
    const fs: Fold[] = []
    let i = 0
    while (i < total) {
      if (keep[i]) {
        out.push(i++)
        continue
      }
      let j = i
      while (j < total && !keep[j]) j++
      const id = fs.length
      fs.push({ start: i, end: j })
      if (expanded.has(id)) for (let k = i; k < j; k++) out.push(k)
      else out.push(-(id + 1))
      i = j
    }
    return { display: Int32Array.from(out), folds: fs }
  }, [collapse, result, total, layout, context, expanded])

  const rowToDisplay = useMemo(() => {
    const m = new Map<number, number>()
    for (let i = 0; i < display.length; i++) if (display[i] >= 0) m.set(display[i], i)
    return m
  }, [display])

  const virtualizer = useVirtualizer({
    count: display.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_H,
    overscan: 20,
    measureElement: wrap ? (el) => el.getBoundingClientRect().height : undefined,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [wrap, layout, virtualizer])

  useImperativeHandle(
    ref,
    () => ({
      scrollToHunk: (index: number) => {
        const h = result.hunks[index]
        if (!h) return
        const row = layout === 'split' ? h.rowStart : h.uRowStart
        const d = rowToDisplay.get(row)
        if (d !== undefined) virtualizer.scrollToIndex(Math.max(0, d - 3), { align: 'start' })
      },
    }),
    [result, layout, rowToDisplay, virtualizer],
  )

  // Hunk membership for highlighting the active change.
  const activeRange = useMemo(() => {
    const h = result.hunks[activeHunk]
    if (!h) return null
    return layout === 'split' ? [h.rowStart, h.rowEnd] : [h.uRowStart, h.uRowEnd]
  }, [result, activeHunk, layout])

  // Horizontal scrolling without wrapping: one shared offset, applied via a CSS variable.
  const maxChars = useMemo(() => {
    if (wrap) return 0
    let m = 0
    for (const l of linesA) if (l.length > m) m = l.length
    for (const l of linesB) if (l.length > m) m = l.length
    return Math.min(m, 100_000)
  }, [linesA, linesB, wrap])
  const contentWidth = maxChars * charWidth() + 48
  const sx = useRef(0)
  const hbar = useRef<HTMLDivElement>(null)
  const applySx = useCallback((x: number) => {
    const el = scroller.current
    if (!el) return
    const viewport = layout === 'split' ? el.clientWidth / 2 - 56 : el.clientWidth - 110
    const max = Math.max(0, contentWidth - viewport)
    sx.current = Math.max(0, Math.min(max, x))
    el.style.setProperty('--sx', `${-sx.current}px`)
    if (hbar.current && Math.abs(hbar.current.scrollLeft - sx.current) > 1) hbar.current.scrollLeft = sx.current
  }, [contentWidth, layout])
  useLayoutEffect(() => applySx(0), [applySx, result])

  const onWheel = (e: React.WheelEvent) => {
    if (wrap) return
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
    if (dx) applySx(sx.current + dx)
  }

  const getInline = (key: number, a: string, b: string): InlineDiff | null => {
    if (granularity === 'line') return null
    const c = inlineCache.current
    if (c.has(key)) return c.get(key)!
    const d = inlineDiff(a, b, granularity, { ignoreCase, whitespace })
    // Don't decorate lines that are essentially rewritten.
    const v = d && d.similarity >= 0.3 ? d : null
    c.set(key, v)
    return v
  }

  const onMouseDown = (e: React.MouseEvent) => {
    // Restrict text selection to the side where the drag started.
    const side = (e.target as HTMLElement).closest('.diff-side-a') ? 'a' : (e.target as HTMLElement).closest('.diff-side-b') ? 'b' : ''
    if (scroller.current) scroller.current.dataset.selectSide = side
  }

  const items = virtualizer.getVirtualItems()

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col bg-workspace', className)}>
      {layout === 'split' && (
        <div className="flex h-8 shrink-0 border-b border-border text-2xs">
          <div className="eyebrow flex flex-1 items-center border-r border-border pl-3">{labels[0]}</div>
          <div className="eyebrow flex flex-1 items-center pl-3">{labels[1]}</div>
        </div>
      )}
      <div
        ref={scroller}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        className="diff-viewer mono relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden text-[12.5px] leading-5 [--sx:0px]"
        role="table"
        aria-label="Differences"
        aria-rowcount={display.length}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((vi) => {
            const entry = display[vi.index]
            if (entry < 0) {
              const fold = folds[-entry - 1]
              const n = fold.end - fold.start
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={wrap ? virtualizer.measureElement : undefined}
                  className="absolute inset-x-0 flex items-center"
                  style={{ transform: `translateY(${vi.start}px)`, height: wrap ? undefined : ROW_H }}
                >
                  <button
                    type="button"
                    onClick={() => setExpanded((s) => new Set(s).add(-entry - 1))}
                    className="flex h-5 w-full items-center gap-2 bg-surface/70 px-3 font-sans text-2xs text-subtle hover:bg-surface-2 hover:text-fg"
                  >
                    <ChevronsUpDown className="size-3" />
                    {formatNumber(n)} unchanged {n === 1 ? 'line' : 'lines'}
                  </button>
                </div>
              )
            }
            const row = entry
            const kind = kinds[row]
            const inActive = activeRange && row >= activeRange[0] && row < activeRange[1]
            let content: React.ReactNode
            if (layout === 'split') {
              const ai = result.aIdx[row]
              const bi = result.bIdx[row]
              const ta = ai >= 0 ? linesA[ai] : null
              const tb = bi >= 0 ? linesB[bi] : null
              const inl = kind === RowKind.Modified && ta !== null && tb !== null ? getInline(row, ta, tb) : null
              const faded = kind === RowKind.IgnoredA || kind === RowKind.IgnoredB
              content = (
                <>
                  <SideCell
                    side="a"
                    lineNo={ai + 1}
                    text={ta}
                    bg={kind === RowKind.Removed || kind === RowKind.Modified ? sideBg[RowKind.Removed] : ''}
                    marker={markerFor(kind, 'a')}
                    ranges={inl?.a ?? null}
                    strong="bg-del-bg-strong rounded-[2px]"
                    wrap={wrap}
                    search={search}
                    faded={faded}
                  />
                  <div className="w-px shrink-0 bg-border" />
                  <SideCell
                    side="b"
                    lineNo={bi + 1}
                    text={tb}
                    bg={kind === RowKind.Added || kind === RowKind.Modified ? sideBg[RowKind.Added] : ''}
                    marker={markerFor(kind, 'b')}
                    ranges={inl?.b ?? null}
                    strong="bg-add-bg-strong rounded-[2px]"
                    wrap={wrap}
                    search={search}
                    faded={faded}
                  />
                </>
              )
            } else {
              const line = result.uLine[row]
              const isA = kind === RowKind.Removed || kind === RowKind.IgnoredA || kind === RowKind.Equal
              const text = isA ? linesA[line] : linesB[line]
              const partner = result.uPartner[row]
              let ranges: InlineRange[] | null = null
              if (partner >= 0) {
                const delRow = kind === RowKind.Removed ? row : partner
                const insRow = kind === RowKind.Removed ? partner : row
                const inl = getInline(delRow, linesA[result.uLine[delRow]], linesB[result.uLine[insRow]])
                ranges = inl ? (kind === RowKind.Removed ? inl.a : inl.b) : null
              }
              // Line numbers: equal rows show both; we derive B's from the side table cheaply.
              const bg = kind === RowKind.Removed ? 'bg-del-bg' : kind === RowKind.Added ? 'bg-add-bg' : ''
              const m = kind === RowKind.Removed ? { ch: '−', cls: 'text-del' } : kind === RowKind.Added ? { ch: '+', cls: 'text-add' } : { ch: '', cls: '' }
              content = (
                <div className={cn('flex min-w-0 flex-1', bg)}>
                  <div className="w-[44px] shrink-0 select-none pr-2 text-right text-subtle tabular">{kind === RowKind.Added || kind === RowKind.IgnoredB ? '' : line + 1}</div>
                  <div className="w-[44px] shrink-0 select-none pr-2 text-right text-subtle tabular">{kind === RowKind.Removed || kind === RowKind.IgnoredA ? '' : uBLine(result, row)}</div>
                  <div className={cn('w-3 shrink-0 select-none text-center', m.cls)}>{m.ch}</div>
                  <div className={cn('min-w-0 flex-1 overflow-hidden pr-3', (kind === RowKind.IgnoredA || kind === RowKind.IgnoredB) && 'opacity-45')}>
                    <div className={cn(wrap ? 'whitespace-pre-wrap break-all' : 'diff-scroll-x whitespace-pre')} style={{ tabSize: 4 }}>
                      {renderSegments(text, ranges, kind === RowKind.Removed ? 'bg-del-bg-strong rounded-[2px]' : 'bg-add-bg-strong rounded-[2px]', search)}
                    </div>
                  </div>
                </div>
              )
            }
            return (
              <div
                key={vi.key}
                role="row"
                data-index={vi.index}
                ref={wrap ? virtualizer.measureElement : undefined}
                className={cn('absolute inset-x-0 flex', inActive && 'shadow-[inset_2px_0_0_var(--accent)]')}
                style={{ transform: `translateY(${vi.start}px)`, minHeight: ROW_H, height: wrap ? undefined : ROW_H }}
              >
                {content}
              </div>
            )
          })}
        </div>
      </div>
      {!wrap && contentWidth > 0 && (
        <div ref={hbar} onScroll={(e) => applySx(e.currentTarget.scrollLeft)} className="h-2.5 shrink-0 overflow-x-auto overflow-y-hidden border-t border-border" aria-hidden>
          <div style={{ width: contentWidth + (layout === 'split' ? 56 : 110), height: 1 }} />
        </div>
      )}
    </div>
  )
})

/** B-side line number for a unified row (equal/added), computed by counting. Cached per result. */
const bLineCache = new WeakMap<TextDiffResult, Int32Array>()
function uBLine(result: TextDiffResult, row: number): number | string {
  let arr = bLineCache.get(result)
  if (!arr) {
    arr = new Int32Array(result.uKinds.length)
    let b = 0
    for (let i = 0; i < result.uKinds.length; i++) {
      const k = result.uKinds[i]
      if (k === RowKind.Equal || k === RowKind.Added || k === RowKind.IgnoredB) arr[i] = ++b
      else arr[i] = 0
    }
    bLineCache.set(result, arr)
  }
  return arr[row] || ''
}
