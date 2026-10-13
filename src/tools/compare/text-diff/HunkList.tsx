import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, X } from 'lucide-react'
import type { Hunk, TextDiffResult } from '@/engines/diff/text-diff'
import { RowKind } from '@/engines/diff/text-diff'
import { CopyButton } from '@/components/common/CopyButton'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

export type HunkFilter = { added: boolean; removed: boolean; modified: boolean }

export function hunkPatch(h: Hunk, linesA: string[], linesB: string[], result: TextDiffResult): string {
  const out = [`@@ -${h.aCount ? h.aStart + 1 : h.aStart}${h.aCount === 1 ? '' : ',' + h.aCount} +${h.bCount ? h.bStart + 1 : h.bStart}${h.bCount === 1 ? '' : ',' + h.bCount} @@`]
  for (let u = h.uRowStart; u < h.uRowEnd; u++) {
    const k = result.uKinds[u]
    const l = result.uLine[u]
    if (k === RowKind.Removed || k === RowKind.IgnoredA) out.push('-' + linesA[l])
    else if (k === RowKind.Added || k === RowKind.IgnoredB) out.push('+' + linesB[l])
  }
  return out.join('\n')
}

function hunkMatches(h: Hunk, q: string, linesA: string[], linesB: string[]) {
  for (let i = 0; i < h.aCount; i++) if (linesA[h.aStart + i]?.toLowerCase().includes(q)) return true
  for (let i = 0; i < h.bCount; i++) if (linesB[h.bStart + i]?.toLowerCase().includes(q)) return true
  return false
}

/** Navigable, searchable, filterable list of change blocks. */
export function HunkList({
  result,
  linesA,
  linesB,
  active,
  onSelect,
  query,
  onQuery,
  filter,
  onFilter,
}: {
  result: TextDiffResult
  linesA: string[]
  linesB: string[]
  active: number
  onSelect: (i: number) => void
  query: string
  onQuery: (q: string) => void
  filter: HunkFilter
  onFilter: (f: HunkFilter) => void
}) {
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out: number[] = []
    result.hunks.forEach((h, i) => {
      const typeOk = (filter.added && h.added > 0) || (filter.removed && h.removed > 0) || (filter.modified && h.modified > 0)
      if (!typeOk) return
      if (q && !hunkMatches(h, q, linesA, linesB)) return
      out.push(i)
    })
    return out
  }, [result, query, filter, linesA, linesB])

  const parent = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: visible.length, getScrollElement: () => parent.current, estimateSize: () => 76, overscan: 8 })

  const chip = (key: keyof HunkFilter, label: string, tone: string) => (
    <button
      type="button"
      aria-pressed={filter[key]}
      onClick={() => onFilter({ ...filter, [key]: !filter[key] })}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-sm border px-1.5 text-2xs font-medium transition-colors',
        filter[key] ? 'border-border-strong bg-selected text-fg' : 'border-transparent text-subtle line-through decoration-subtle/60 hover:text-muted',
      )}
    >
      <span className={cn('size-1.5 rounded-full', tone)} />
      {label}
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search changed lines…"
            aria-label="Search differences"
            className="h-7 w-full rounded-md border border-border bg-workspace pl-7 pr-7 text-xs text-fg outline-none placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
          {query && (
            <button type="button" onClick={() => onQuery('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-subtle hover:text-fg">
              <X className="size-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {chip('added', 'Added', 'bg-add')}
          {chip('removed', 'Removed', 'bg-del')}
          {chip('modified', 'Modified', 'bg-mod')}
          <span className="ml-auto text-2xs text-subtle tabular">
            {formatNumber(visible.length)}/{formatNumber(result.hunks.length)}
          </span>
        </div>
      </div>
      <div ref={parent} className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Changes">
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-subtle">{result.hunks.length ? 'No changes match the filters.' : 'No changes.'}</p>
        ) : (
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((vi) => {
              const idx = visible[vi.index]
              const h = result.hunks[idx]
              const firstA = h.aCount ? linesA[h.aStart] : null
              const firstB = h.bCount ? linesB[h.bStart] : null
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={v.measureElement}
                  role="option"
                  aria-selected={idx === active}
                  tabIndex={0}
                  onClick={() => onSelect(idx)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(idx))}
                  className={cn(
                    'group absolute inset-x-0 cursor-default border-b border-border px-2.5 py-2 outline-none hover:bg-surface-2/60 focus-visible:bg-surface-2',
                    idx === active && 'bg-accent-soft hover:bg-accent-soft',
                  )}
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <div className="flex items-center gap-2 text-2xs">
                    <span className="mono text-subtle">
                      {h.aCount ? `L${h.aStart + 1}` : '—'} → {h.bCount ? `L${h.bStart + 1}` : '—'}
                    </span>
                    <span className="flex gap-1.5 tabular">
                      {h.added > 0 && <span className="text-add">+{h.added}</span>}
                      {h.removed > 0 && <span className="text-del">−{h.removed}</span>}
                      {h.modified > 0 && <span className="text-mod">~{h.modified}</span>}
                    </span>
                    <span className="ml-auto opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" onClick={(e) => e.stopPropagation()}>
                      <CopyButton size="icon-xs" value={() => hunkPatch(h, linesA, linesB, result)} label="Copy this change as a patch" />
                    </span>
                  </div>
                  <div className="mono mt-1 flex flex-col gap-px text-[11.5px] leading-[16px]">
                    {firstA !== null && <span className="truncate rounded-[2px] bg-del-bg px-1 text-fg/90">−{firstA || ' '}</span>}
                    {firstB !== null && <span className="truncate rounded-[2px] bg-add-bg px-1 text-fg/90">+{firstB || ' '}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
