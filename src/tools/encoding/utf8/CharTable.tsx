import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { decodeUtf8At } from '@/engines/encoding/utf8'
import type { ByteRange } from './HexDump'
import { cn } from '@/utils/cn'

const HEX = (n: number, w = 2) => n.toString(16).toUpperCase().padStart(w, '0')
const COLS = 'grid grid-cols-[48px_40px_88px_minmax(130px,1.4fr)_64px_72px_minmax(84px,1fr)] items-center gap-x-3'
const LIMIT = 500_000

interface Row {
  index: number
  offset: number
  length: number
  cp: number
}

function glyph(cp: number): { text: string; dim: boolean } {
  if (cp === 0x20) return { text: '␣', dim: true }
  if (cp < 0x20) return { text: String.fromCodePoint(0x2400 + cp), dim: true }
  if (cp === 0x7f) return { text: '␡', dim: true }
  if (cp === 0xfeff) return { text: 'BOM', dim: true }
  const s = String.fromCodePoint(cp)
  if (/\p{M}/u.test(s)) return { text: `◌${s}`, dim: false }
  if (/\p{Cf}|\p{Z}/u.test(s)) return { text: '·', dim: true }
  return { text: s, dim: false }
}

/** Per-character breakdown of (valid) UTF-8 bytes: offsets, byte sequences and UTF-16 units. */
export function CharTable({ bytes, selected, onSelect }: { bytes: Uint8Array; selected: ByteRange | null; onSelect: (r: ByteRange) => void }) {
  const rows = useMemo(() => {
    const out: Row[] = []
    for (let i = 0; i < bytes.length && out.length < LIMIT; ) {
      const seq = decodeUtf8At(bytes, i)
      out.push({ index: out.length, offset: i, length: seq.length, cp: seq.cp })
      i += seq.length
    }
    return out
  }, [bytes])
  const scroller = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => 28, overscan: 12 })

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
      <div className="min-w-[640px]">
        <div className={cn(COLS, 'eyebrow sticky top-0 z-10 h-8 border-b border-border bg-workspace px-3')}>
          <span className="text-right">#</span>
          <span>Char</span>
          <span>Code point</span>
          <span>UTF-8 bytes</span>
          <span className="text-right">Bytes</span>
          <span className="text-right">Offset</span>
          <span>UTF-16</span>
        </div>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => {
            const r = rows[it.index]
            const bad = r.cp === -1
            const g = bad ? { text: '�', dim: false } : glyph(r.cp)
            const sel = selected?.start === r.offset
            const units = r.cp > 0xffff ? [0xd800 + ((r.cp - 0x10000) >> 10), 0xdc00 + ((r.cp - 0x10000) & 0x3ff)] : [r.cp]
            return (
              <button
                type="button"
                key={it.key}
                onClick={() => onSelect({ start: r.offset, length: r.length })}
                className={cn(COLS, 'absolute inset-x-0 border-b border-border/60 px-3 text-left text-sm hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', sel && 'bg-accent-soft hover:bg-accent-soft', bad && 'bg-danger-soft')}
                style={{ height: it.size, transform: `translateY(${it.start}px)` }}
              >
                <span className="text-right text-2xs text-subtle tabular">{r.index}</span>
                <span className={cn('truncate text-base leading-none', g.dim ? 'text-xs text-subtle' : bad ? 'text-danger' : 'text-fg')}>{g.text}</span>
                <span className={cn('mono text-[12.5px]', bad ? 'text-danger' : 'text-fg')}>{bad ? 'invalid' : `U+${HEX(r.cp, 4)}`}</span>
                <span className="mono flex gap-1 text-[12px]">
                  {Array.from(bytes.subarray(r.offset, r.offset + r.length), (b, k) => (
                    <span key={k} className={k === 0 ? 'text-accent-text' : 'text-muted'}>
                      {HEX(b)}
                    </span>
                  ))}
                </span>
                <span className="text-right text-xs text-muted tabular">{r.length}</span>
                <span className="mono text-right text-[12px] text-muted">{r.offset}</span>
                <span className="mono truncate text-[12px] text-subtle">{bad ? '—' : units.map((u) => HEX(u, 4)).join(' ')}</span>
              </button>
            )
          })}
        </div>
        {rows.length >= LIMIT && <p className="px-3 py-2 text-xs text-subtle">Only the first {LIMIT.toLocaleString()} characters are listed.</p>}
      </div>
    </div>
  )
}
