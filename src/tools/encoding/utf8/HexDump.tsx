import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { sequenceContaining, type Utf8Seq } from '@/engines/encoding/utf8'
import { cn } from '@/utils/cn'

export interface ByteRange {
  start: number
  length: number
}

export interface HexDumpHandle {
  reveal: (offset: number) => void
}

const ROW_H = 20
/** Browsers cap element heights (~33M px in Chrome); beyond this the scrollbar is scaled. */
const MAX_SCROLL_H = 8_000_000
const HEX = Array.from({ length: 256 }, (_, b) => b.toString(16).toUpperCase().padStart(2, '0'))

function charFor(seq: Utf8Seq, i: number): { text: string; cls: string } {
  if (seq.cp === -1) return { text: '�', cls: 'text-danger' }
  if (seq.start !== i) return { text: '', cls: '' }
  const cp = seq.cp
  if (cp === 0x20) return { text: '␣', cls: 'text-subtle' }
  if (cp < 0x20 || cp === 0x7f) return { text: '.', cls: 'text-subtle' }
  if (cp === 0xfeff && i === 0) return { text: 'BOM', cls: 'text-mod text-[9px] tracking-tight' }
  if (cp >= 0x80 && cp <= 0x9f) return { text: '.', cls: 'text-subtle' }
  if (/\p{M}|\p{Cf}|\p{Zs}/u.test(String.fromCodePoint(cp))) return { text: '·', cls: 'text-accent-text' }
  return { text: String.fromCodePoint(cp), cls: cp < 0x80 ? 'text-fg' : 'text-accent-text' }
}

function byteClass(seq: Utf8Seq, i: number, bomLen: number): string {
  if (i < bomLen) return 'text-mod'
  if (seq.cp === -1) return 'text-danger'
  if (seq.length === 1) return seq.cp < 0x20 || seq.cp === 0x7f ? 'text-subtle' : 'text-fg'
  return seq.start === i ? 'text-accent-text' : 'text-accent-text/70'
}

export const HexDump = forwardRef<HexDumpHandle, {
  bytes: Uint8Array
  bytesPerRow: number
  bomLength: number
  selected: ByteRange | null
  onSelect: (r: ByteRange | null) => void
}>(function HexDump({ bytes, bytesPerRow, bomLength, selected, onSelect }, ref) {
  const scroller = useRef<HTMLDivElement>(null)
  const [viewH, setViewH] = useState(400)
  const [scrollTop, setScrollTop] = useState(0)
  const [hover, setHover] = useState<ByteRange | null>(null)
  const rows = Math.ceil(bytes.length / bytesPerRow)
  const fullH = rows * ROW_H
  const spacerH = Math.min(fullH, MAX_SCROLL_H)
  const scale = fullH > spacerH && spacerH > viewH ? (fullH - viewH) / (spacerH - viewH) : 1

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    // New data: back to the top.
    if (scroller.current) scroller.current.scrollTop = 0
    setScrollTop(0)
    setHover(null)
  }, [bytes])

  const reveal = useCallback(
    (offset: number) => {
      const el = scroller.current
      if (!el) return
      const row = Math.floor(offset / bytesPerRow)
      const virtualTop = Math.max(0, row * ROW_H - viewH / 3)
      el.scrollTop = virtualTop / scale
    },
    [bytesPerRow, viewH, scale],
  )
  useImperativeHandle(ref, () => ({ reveal }), [reveal])

  const virtualTop = scrollTop * scale
  const first = Math.max(0, Math.floor(virtualTop / ROW_H))
  const shift = virtualTop - first * ROW_H
  const count = Math.min(rows - first, Math.ceil(viewH / ROW_H) + 2)

  const rangeAt = (target: EventTarget): ByteRange | null => {
    const off = (target as HTMLElement).closest<HTMLElement>('[data-o]')?.dataset.o
    if (off == null) return null
    const seq = sequenceContaining(bytes, Number(off))
    return { start: seq.start, length: seq.length }
  }
  const inRange = (r: ByteRange | null, i: number) => !!r && i >= r.start && i < r.start + r.length

  const offsetDigits = Math.max(8, (bytes.length - 1).toString(16).length)
  const rowEls = []
  for (let r = first; r < first + count; r++) {
    const base = r * bytesPerRow
    const hexCells = []
    const charCells = []
    for (let c = 0; c < bytesPerRow; c++) {
      const i = base + c
      if (i >= bytes.length) {
        hexCells.push(<span key={c} className={cn('w-[2.6ch]', c === bytesPerRow / 2 && 'ml-[1ch]')} />)
        charCells.push(<span key={c} className="w-[1ch]" />)
        continue
      }
      const seq = sequenceContaining(bytes, i)
      const sel = inRange(selected, i)
      const hov = !sel && inRange(hover, i)
      const ch = charFor(seq, i)
      const bg = sel ? 'bg-accent-soft outline outline-1 -outline-offset-1 outline-accent/50' : hov ? 'bg-surface-2' : seq.cp === -1 ? 'bg-danger-soft' : i < bomLength ? 'bg-mod-bg' : ''
      hexCells.push(
        <span key={c} data-o={i} className={cn('w-[2.6ch] rounded-xs text-center', byteClass(seq, i, bomLength), bg, c === bytesPerRow / 2 && 'ml-[1ch]')}>
          {HEX[bytes[i]]}
        </span>,
      )
      charCells.push(
        <span key={c} data-o={i} className={cn('relative w-[1ch] whitespace-nowrap rounded-xs text-center', ch.cls, bg)}>
          {ch.text}
        </span>,
      )
    }
    rowEls.push(
      <div key={r} className="flex h-5 items-center gap-[1.5ch] px-3" style={{ height: ROW_H }}>
        <span className="w-[calc(var(--od)*1ch)] shrink-0 text-subtle">{base.toString(16).toUpperCase().padStart(offsetDigits, '0')}</span>
        <span className="flex shrink-0">{hexCells}</span>
        <span className="flex shrink-0 border-l border-border pl-[1ch]">{charCells}</span>
      </div>,
    )
  }

  return (
    <div
      ref={scroller}
      className="mono relative min-h-0 flex-1 overflow-auto text-[12.5px] leading-5 tabular outline-none"
      tabIndex={0}
      aria-label="Hex dump"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onMouseOver={(e) => {
        const r = rangeAt(e.target)
        if (r?.start !== hover?.start) setHover(r)
      }}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => {
        const r = rangeAt(e.target)
        onSelect(r && selected && r.start === selected.start ? null : r)
      }}
      style={{ ['--od' as string]: offsetDigits }}
    >
      <div style={{ height: spacerH }} className="relative w-max min-w-full">
        <div className="sticky top-0 overflow-hidden" style={{ height: Math.min(viewH, spacerH) }}>
          <div style={{ transform: `translateY(${-shift}px)` }} className="w-max">
            {rowEls}
          </div>
        </div>
      </div>
    </div>
  )
})
