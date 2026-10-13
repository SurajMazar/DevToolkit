import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatStructureDiff, type StructureDiff, type StructureDiffEntry } from '@/engines/json-tools/object-utils'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { CopyButton } from '@/components/common/CopyButton'
import { DownloadButton } from '@/components/common/DownloadButton'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

const ROW = 28

const KIND = {
  onlyA: { sym: '−', label: 'Only in A', cls: 'text-del', bg: 'bg-del-bg' },
  onlyB: { sym: '+', label: 'Only in B', cls: 'text-add', bg: 'bg-add-bg' },
  typeChanged: { sym: '~', label: 'Type changed', cls: 'text-mod', bg: 'bg-mod-bg' },
  same: { sym: '·', label: 'Same', cls: 'text-subtle', bg: '' },
} as const

function Types({ e }: { e: StructureDiffEntry }) {
  if (e.kind === 'typeChanged')
    return (
      <span className="mono text-xs">
        <span className="text-del">{e.typesA.join(' | ')}</span>
        <span className="text-subtle"> → </span>
        <span className="text-add">{e.typesB.join(' | ')}</span>
      </span>
    )
  return <span className="mono text-xs text-muted">{(e.kind === 'onlyB' ? e.typesB : e.typesA).join(' | ')}</span>
}

/** Structural comparison of two documents: key paths present on one side only, and type changes. */
export function CompareView({ diff, empty }: { diff: StructureDiff | null; empty?: React.ReactNode }) {
  const [filter, setFilter] = useState<'diff' | 'all'>('diff')
  const ref = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => (diff ? (filter === 'all' ? diff.entries : diff.entries.filter((e) => e.kind !== 'same')) : []), [diff, filter])
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => ROW, overscan: 12 })
  const report = () => (diff ? formatStructureDiff(diff, filter === 'all') : '')

  return (
    <Pane aria-label="Structure comparison">
      <PaneHeader
        title="Structure"
        meta={diff ? `${formatNumber(diff.entries.length)} key paths compared` : undefined}
        actions={
          <>
            <CopyButton label="Copy report" value={report} disabled={!diff} />
            <DownloadButton label="Download report" getContent={report} filename="structure-diff.txt" disabled={!diff} />
          </>
        }
      />
      {diff ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2">
            {(['onlyA', 'onlyB', 'typeChanged', 'same'] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-xs">
                <span className={cn('mono flex size-4 items-center justify-center rounded-sm text-[11px] font-semibold', KIND[k].cls, KIND[k].bg || 'bg-surface-2')}>{KIND[k].sym}</span>
                <span className="text-muted">{KIND[k].label}</span>
                <span className="text-fg tabular">{formatNumber(diff[k])}</span>
              </span>
            ))}
            <Segmented
              size="xs"
              aria-label="Show"
              className="ml-auto"
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: 'diff', label: 'Differences' },
                { value: 'all', label: 'All paths' },
              ]}
            />
          </div>
          <div className="relative min-h-0 flex-1">
            {rows.length ? (
              <div ref={ref} role="table" aria-label="Key paths" className="h-full overflow-auto">
                <div style={{ height: v.getTotalSize(), position: 'relative' }}>
                  {v.getVirtualItems().map((it) => {
                    const e = rows[it.index]
                    const k = KIND[e.kind]
                    return (
                      <div key={it.index} role="row" className={cn('absolute left-0 flex w-full items-center gap-3 border-b border-border/50 px-3', e.kind !== 'same' && k.bg)} style={{ top: it.start, height: ROW }}>
                        <span className={cn('mono w-3 shrink-0 text-center text-xs font-semibold', k.cls)} aria-label={k.label}>
                          {k.sym}
                        </span>
                        <span className="mono min-w-0 flex-1 truncate text-xs text-fg" title={e.path}>
                          {e.path}
                        </span>
                        <Types e={e} />
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <EmptyState compact title="Same structure" description="Both documents have the same key paths with the same types. Values may still differ — use JSON Diff to compare values." />
            )}
          </div>
        </>
      ) : (
        <div className="relative min-h-0 flex-1">{empty}</div>
      )}
    </Pane>
  )
}
