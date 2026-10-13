import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, X } from 'lucide-react'
import type { ChangeType, JsonChange } from '@/engines/diff/json-diff'
import { previewValue } from '@/engines/diff/json-diff'
import { stringifyJson } from '@/engines/json/stringify'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { copyText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

export type ChangeFilter = Record<ChangeType, boolean>

export const TYPE_META: Record<ChangeType, { label: string; dot: string; text: string; bg: string }> = {
  added: { label: 'Added', dot: 'bg-add', text: 'text-add', bg: 'bg-add-bg' },
  removed: { label: 'Removed', dot: 'bg-del', text: 'text-del', bg: 'bg-del-bg' },
  modified: { label: 'Modified', dot: 'bg-mod', text: 'text-mod', bg: 'bg-mod-bg' },
  type: { label: 'Type changed', dot: 'bg-mod', text: 'text-mod', bg: 'bg-mod-bg' },
  order: { label: 'Key order', dot: 'bg-subtle', text: 'text-muted', bg: 'bg-surface-2' },
}

export function changeToPatchOp(c: JsonChange) {
  if (c.type === 'added') return { op: 'add', path: c.rightPointer, value: c.right }
  if (c.type === 'removed') return { op: 'remove', path: c.leftPointer }
  return { op: 'replace', path: c.leftPointer, value: c.right }
}

export function useFilteredChanges(changes: JsonChange[], query: string, filter: ChangeFilter) {
  return useMemo(() => {
    const q = query.trim().toLowerCase()
    const out: number[] = []
    changes.forEach((c, i) => {
      if (!filter[c.type]) return
      if (q) {
        const hay = `${c.pathText} ${c.left !== undefined ? previewValue(c.left) : ''} ${c.right !== undefined ? previewValue(c.right) : ''}`.toLowerCase()
        if (!hay.includes(q)) return
      }
      out.push(i)
    })
    return out
  }, [changes, query, filter])
}

export function FilterBar({
  changes,
  query,
  onQuery,
  filter,
  onFilter,
  shown,
}: {
  changes: JsonChange[]
  query: string
  onQuery: (q: string) => void
  filter: ChangeFilter
  onFilter: (f: ChangeFilter) => void
  shown: number
}) {
  const counts = useMemo(() => {
    const c: Record<ChangeType, number> = { added: 0, removed: 0, modified: 0, type: 0, order: 0 }
    for (const ch of changes) c[ch.type]++
    return c
  }, [changes])
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg px-3 py-2">
      <div className="relative w-64 max-w-full">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filter by path or value…"
          aria-label="Filter changes"
          className="h-7 w-full rounded-md border border-border bg-workspace pl-7 pr-7 text-xs text-fg outline-none placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        {query && (
          <button type="button" onClick={() => onQuery('')} aria-label="Clear filter" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-subtle hover:text-fg">
            <X className="size-3" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(TYPE_META) as ChangeType[])
          .filter((t) => counts[t] > 0 || t !== 'order')
          .map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={filter[t]}
              onClick={() => onFilter({ ...filter, [t]: !filter[t] })}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded-sm border px-1.5 text-2xs font-medium transition-colors',
                filter[t] ? 'border-border-strong bg-selected text-fg' : 'border-transparent text-subtle line-through decoration-subtle/60 hover:text-muted',
              )}
            >
              <span className={cn('size-1.5 rounded-full', TYPE_META[t].dot)} />
              {TYPE_META[t].label}
              <span className="text-subtle tabular">{formatNumber(counts[t])}</span>
            </button>
          ))}
      </div>
      <span className="ml-auto text-2xs text-subtle tabular">
        Showing {formatNumber(shown)} of {formatNumber(changes.length)}
      </span>
    </div>
  )
}

/** Flat, virtualized list of structural changes with per-change copy actions. */
export function ChangeList({ changes, visible, onReveal }: { changes: JsonChange[]; visible: number[]; onReveal?: (index: number) => void }) {
  const parent = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: visible.length, getScrollElement: () => parent.current, estimateSize: () => 52, overscan: 10 })
  if (!visible.length) return <p className="flex-1 bg-workspace px-4 py-10 text-center text-sm text-muted">No changes match the current filters.</p>
  return (
    <div ref={parent} className="min-h-0 flex-1 overflow-y-auto bg-workspace" role="list" aria-label="Changes">
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((vi) => {
          const idx = visible[vi.index]
          const c = changes[idx]
          const meta = TYPE_META[c.type]
          return (
            <div
              key={vi.key}
              role="listitem"
              data-index={vi.index}
              ref={v.measureElement}
              className="group absolute inset-x-0 flex items-start gap-3 border-b border-border px-3 py-2 hover:bg-surface-2/50"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <span className={cn('mt-0.5 inline-flex h-[18px] w-[92px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 text-2xs font-medium', meta.bg, meta.text)}>
                <span className={cn('size-1.5 rounded-full', meta.dot)} />
                {meta.label}
              </span>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onReveal?.(idx)} className="mono block max-w-full truncate text-left text-[12.5px] text-fg hover:underline" title={c.pathText}>
                  {c.pathText}
                </button>
                <div className="mono mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  {c.left !== undefined && c.type !== 'order' && <span className={cn('max-w-full truncate rounded-[2px] px-1', c.type === 'removed' ? 'bg-del-bg' : 'bg-del-bg/70 line-through decoration-del/50')}>{previewValue(c.left)}</span>}
                  {c.left !== undefined && c.right !== undefined && c.type !== 'order' && <span className="text-subtle">→</span>}
                  {c.right !== undefined && c.type !== 'order' && <span className="max-w-full truncate rounded-[2px] bg-add-bg px-1">{previewValue(c.right)}</span>}
                  {c.type === 'type' && <span className="font-sans text-2xs text-subtle">{c.leftType} → {c.rightType}</span>}
                  {c.type === 'order' && <span className="font-sans text-2xs text-subtle">Keys appear in a different order</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                <ChangeCopyMenu change={c} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ChangeCopyMenu({ change: c }: { change: JsonChange }) {
  const copy = async (label: string, text: string) => toast[(await copyText(text)) ? 'success' : 'error'](`${label} copied`)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Copy…">
          <Copy />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => copy('Path', c.pathText)}>Copy JSONPath</DropdownMenuItem>
        {c.leftPointer !== null && <DropdownMenuItem onSelect={() => copy('Pointer', c.leftPointer!)}>Copy JSON Pointer (original)</DropdownMenuItem>}
        {c.rightPointer !== null && <DropdownMenuItem onSelect={() => copy('Pointer', c.rightPointer!)}>Copy JSON Pointer (modified)</DropdownMenuItem>}
        {c.left !== undefined && c.type !== 'order' && <DropdownMenuItem onSelect={() => copy('Original value', stringifyJson(c.left, { indent: 2 }))}>Copy original value</DropdownMenuItem>}
        {c.right !== undefined && c.type !== 'order' && <DropdownMenuItem onSelect={() => copy('New value', stringifyJson(c.right, { indent: 2 }))}>Copy new value</DropdownMenuItem>}
        {c.type !== 'order' && <DropdownMenuItem onSelect={() => copy('Patch operation', stringifyJson(changeToPatchOp(c), { indent: 2 }))}>Copy as JSON Patch op</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
