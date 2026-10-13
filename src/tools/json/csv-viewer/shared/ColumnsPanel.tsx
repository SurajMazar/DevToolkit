import { useState } from 'react'
import { RotateCcw, Search } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'

export interface ColumnItem {
  key: string
  /** Current output name ('' or equal to key = not renamed). */
  rename: string
  included: boolean
  /** Short type label (num, str, bool, mixed…). */
  kind?: string
  /** Secondary info, e.g. "118/120 rows". */
  detail?: string
}

interface ColumnsPanelProps {
  items: ColumnItem[]
  onToggle: (key: string, included: boolean) => void
  onRename: (key: string, name: string) => void
  onAll: (included: boolean) => void
  onReset: () => void
  /** Controls rendered above the list (e.g. sort toggle). */
  extra?: React.ReactNode
  className?: string
  emptyText?: string
}

/** Column picker: include/exclude and rename. Renames edit the header text in place. */
export function ColumnsPanel({ items, onToggle, onRename, onAll, onReset, extra, className, emptyText = 'Columns appear here once the input parses.' }: ColumnsPanelProps) {
  const [q, setQ] = useState('')
  const included = items.filter((i) => i.included).length
  const renamed = items.filter((i) => i.rename && i.rename !== i.key).length
  const shown = q ? items.filter((i) => i.key.toLowerCase().includes(q.toLowerCase()) || i.rename.toLowerCase().includes(q.toLowerCase())) : items
  const allState = included === items.length ? true : included === 0 ? false : 'indeterminate'

  return (
    <aside aria-label="Columns" className={cn('flex min-h-0 flex-1 flex-col bg-workspace', className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
        <h2 className="eyebrow">Columns</h2>
        <span className="text-2xs text-subtle tabular">
          {items.length ? `${included}/${items.length}` : ''}
          {renamed ? ` · ${renamed} renamed` : ''}
        </span>
        <div className="ml-auto flex items-center">
          <IconButton label="Reset column choices" icon={<RotateCcw />} onClick={onReset} disabled={!renamed && included === items.length} />
        </div>
      </div>
      {extra && <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">{extra}</div>}
      {items.length > 0 ? (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
            <Checkbox checked={allState} onCheckedChange={(v) => onAll(v === true)} aria-label="Include all columns" />
            {items.length > 8 ? (
              <label className="flex min-w-0 flex-1 items-center gap-1.5 text-subtle">
                <Search className="size-3.5 shrink-0" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find column…" aria-label="Find column" className="h-7 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle" />
              </label>
            ) : (
              <span className="text-xs text-muted">All columns</span>
            )}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {shown.map((it) => {
              const isRenamed = !!it.rename && it.rename !== it.key
              return (
                <li key={it.key} className={cn('group flex h-8 items-center gap-2 pl-3 pr-2', !it.included && 'opacity-55')}>
                  <Checkbox checked={it.included} onCheckedChange={(v) => onToggle(it.key, v === true)} aria-label={`Include ${it.key}`} />
                  <input
                    value={it.rename || it.key}
                    onChange={(e) => onRename(it.key, e.target.value === it.key ? '' : e.target.value)}
                    aria-label={`Name for column ${it.key}`}
                    title={isRenamed ? `Renamed from “${it.key}”` : `Click to rename “${it.key}”`}
                    spellCheck={false}
                    className={cn(
                      'mono h-6 min-w-0 flex-1 truncate rounded-sm border border-transparent bg-transparent px-1.5 text-[12px] text-fg outline-none transition-colors hover:border-border focus:border-accent focus:bg-workspace',
                      isRenamed && 'text-accent-text',
                    )}
                  />
                  {isRenamed && (
                    <button type="button" onClick={() => onRename(it.key, '')} className="shrink-0 text-2xs text-subtle hover:text-fg" title={`Restore “${it.key}”`}>
                      undo
                    </button>
                  )}
                  {it.kind && <span className="w-9 shrink-0 text-right text-2xs text-subtle">{it.kind}</span>}
                </li>
              )
            })}
            {!shown.length && <li className="px-3 py-3 text-sm text-muted">No column matches “{q}”.</li>}
          </ul>
          {included === 0 && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-warn">
              Every column is excluded.
              <Button size="xs" variant="ghost" onClick={() => onAll(true)}>
                Include all
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="px-3 py-4 text-sm text-muted">{emptyText}</p>
      )}
    </aside>
  )
}
