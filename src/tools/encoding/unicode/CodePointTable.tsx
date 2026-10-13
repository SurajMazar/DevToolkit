import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CATEGORY_NAMES, codePoints, formatCodePoint, generalCategory } from '@/engines/encoding/unicode'
import { CopyButton } from '@/components/common/CopyButton'
import { EmptyState } from '@/components/tools/EmptyState'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { formatNumber } from '@/utils/format'
import { cn } from '@/utils/cn'

const LIMIT = 200_000
const hex = (n: number, w = 2) => n.toString(16).toUpperCase().padStart(w, '0')

/** Glyph to show for invisible / combining code points. */
function visible(cp: number, char: string, cat: string): { text: string; dim: boolean } {
  if (cp === 0x20) return { text: '␠', dim: true }
  if (cp === 0x0a) return { text: '␊', dim: true }
  if (cp === 0x09) return { text: '␉', dim: true }
  if (cp === 0x0d) return { text: '␍', dim: true }
  if (cat === 'Cc') return { text: cp < 0x20 ? String.fromCodePoint(0x2400 + cp) : '␡', dim: true }
  if (cat === 'Cf' || cat === 'Zs' || cat === 'Zl' || cat === 'Zp' || cat === 'Cn' || cat === 'Cs') return { text: '·', dim: true }
  if (cat.startsWith('M')) return { text: `◌${char}`, dim: false }
  return { text: char, dim: false }
}

const COLS = 'grid grid-cols-[52px_44px_96px_minmax(120px,1fr)_minmax(110px,1.1fr)_minmax(90px,0.8fr)] items-center gap-x-3'

export function CodePointTable({ text, title = 'Code points' }: { text: string; title?: string }) {
  const { items, total } = useMemo(() => codePoints(text, LIMIT), [text])
  const scroller = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({ count: items.length, getScrollElement: () => scroller.current, estimateSize: () => 30, overscan: 12 })
  const categories = useRef(new Map<number, string>())
  const catOf = (cp: number) => {
    let c = categories.current.get(cp)
    if (!c) {
      c = generalCategory(cp)
      categories.current.set(cp, c)
    }
    return c
  }

  const tsv = () =>
    ['Index\tChar\tCode point\tCategory\tUTF-8\tUTF-16', ...items.map((it, i) => `${i}\t${it.lone ? '' : it.char}\t${formatCodePoint(it.cp)}\t${it.lone ? 'Unpaired surrogate' : CATEGORY_NAMES[catOf(it.cp)]}\t${it.utf8.map((b) => hex(b)).join(' ')}\t${it.utf16.map((u) => hex(u, 4)).join(' ')}`)].join('\n')

  return (
    <Pane aria-label={title}>
      <PaneHeader
        title={title}
        meta={total ? `${formatNumber(total)} code points${total > LIMIT ? ` · first ${formatNumber(LIMIT)} listed` : ''}` : undefined}
        actions={<CopyButton value={tsv} label="Copy table as TSV" disabled={!items.length} />}
      />
      {!items.length ? (
        <EmptyState compact title="No characters yet." description="Each code point will be listed with its category, UTF-8 bytes and UTF-16 code units." />
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-[620px]">
            <div className={cn(COLS, 'eyebrow sticky top-0 z-10 h-8 border-b border-border bg-workspace px-3')}>
              <span className="text-right">#</span>
              <span>Char</span>
              <span>Code point</span>
              <span>Category</span>
              <span>UTF-8</span>
              <span>UTF-16</span>
            </div>
            <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
              {virtual.getVirtualItems().map((v) => {
                const it = items[v.index]
                const cat = it.lone ? 'Cs' : catOf(it.cp)
                const g = visible(it.cp, it.char, cat)
                return (
                  <div
                    key={v.key}
                    className={cn(COLS, 'absolute inset-x-0 border-b border-border/60 px-3 text-sm hover:bg-surface-2/60', it.lone && 'bg-danger-soft')}
                    style={{ height: v.size, transform: `translateY(${v.start}px)` }}
                  >
                    <span className="text-right text-2xs text-subtle tabular">{v.index}</span>
                    <span className={cn('truncate text-base leading-none', g.dim ? 'text-subtle' : 'text-fg')}>{g.text}</span>
                    <span className="mono text-[12.5px] text-fg">{formatCodePoint(it.cp)}</span>
                    <span className={cn('truncate text-xs', it.lone ? 'text-danger' : 'text-muted')} title={cat}>
                      {it.lone ? 'Unpaired surrogate' : CATEGORY_NAMES[cat]}
                    </span>
                    <span className="mono truncate text-[12px] text-muted">{it.lone ? 'invalid' : it.utf8.map((b) => hex(b)).join(' ')}</span>
                    <span className="mono truncate text-[12px] text-muted">{it.utf16.map((u) => hex(u, 4)).join(' ')}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </Pane>
  )
}
