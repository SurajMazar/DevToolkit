import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { NodeStatus, type TreeTable } from '@/engines/diff/json-diff'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

export interface DiffTreeHandle {
  reveal: (node: number) => void
}

interface DiffTreeProps {
  tree: TreeTable
  /** Nodes whose expansion differs from the default (default: expand nodes containing changes). */
  toggled: Set<number>
  onToggle: (node: number) => void
  onlyChanges: boolean
  selected: number
  onSelect: (node: number) => void
}


export function defaultExpanded(tree: TreeTable, i: number) {
  return i === 0 || tree.status[i] === NodeStatus.Contains
}

const valueClass: Record<string, string> = {
  string: 'text-[color:var(--json-string)]',
  number: 'text-[color:var(--json-number)]',
  boolean: 'text-[color:var(--json-bool)]',
  null: 'text-subtle',
  object: 'text-subtle',
  array: 'text-subtle',
}

/** Virtualized union tree of both documents with per-node change status. */
export const DiffTree = forwardRef<DiffTreeHandle, DiffTreeProps>(function DiffTree({ tree, toggled, onToggle, onlyChanges, selected, onSelect }, ref) {
  const parent = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => {
    const out: number[] = []
    const n = tree.depth.length
    let i = 0
    while (i < n) {
      const st = tree.status[i]
      if (onlyChanges && (st === NodeStatus.Equal || st === NodeStatus.Ignored)) {
        i = tree.end[i]
        continue
      }
      out.push(i)
      const container = tree.end[i] > i + 1
      const open = defaultExpanded(tree, i) !== toggled.has(i)
      i = container && !open ? tree.end[i] : i + 1
    }
    return out
  }, [tree, toggled, onlyChanges])

  const indexOf = useMemo(() => new Map(visible.map((n, i) => [n, i])), [visible])
  const v = useVirtualizer({ count: visible.length, getScrollElement: () => parent.current, estimateSize: () => 24, overscan: 24 })

  useImperativeHandle(ref, () => ({
    reveal: (node: number) => {
      const i = indexOf.get(node)
      if (i !== undefined) v.scrollToIndex(i, { align: 'center' })
    },
  }), [indexOf, v])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const pos = indexOf.get(selected) ?? -1
    const node = selected
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = visible[Math.max(0, Math.min(visible.length - 1, pos + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next !== undefined) {
        onSelect(next)
        v.scrollToIndex(indexOf.get(next)!, { align: 'auto' })
      }
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && node >= 0) {
      e.preventDefault()
      const container = tree.end[node] > node + 1
      const open = defaultExpanded(tree, node) !== toggled.has(node)
      if (container && open !== (e.key === 'ArrowRight')) onToggle(node)
      else if (e.key === 'ArrowLeft' && tree.parent[node] >= 0) onSelect(tree.parent[node])
    } else if (e.key === 'Enter' && node >= 0) {
      onToggle(node)
    }
  }

  return (
    <div
      ref={parent}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="tree"
      aria-label="Structural differences"
      className="mono min-h-0 flex-1 overflow-auto bg-workspace py-1 text-[12.5px] leading-6 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <div style={{ height: v.getTotalSize(), position: 'relative', minWidth: '100%' }}>
        {v.getVirtualItems().map((vi) => {
          const i = visible[vi.index]
          const st = tree.status[i]
          const lk = tree.leftKind[i]
          const rk = tree.rightKind[i]
          const container = tree.end[i] > i + 1
          const open = container && defaultExpanded(tree, i) !== toggled.has(i)
          const depth = tree.depth[i]
          const count = tree.changes[i]
          const rowTone =
            st === NodeStatus.Added ? 'bg-add-bg' : st === NodeStatus.Removed ? 'bg-del-bg' : ''
          const marker = st === NodeStatus.Added ? '+' : st === NodeStatus.Removed ? '−' : st === NodeStatus.Modified || st === NodeStatus.TypeChanged ? '~' : ''
          const markerTone = st === NodeStatus.Added ? 'text-add' : st === NodeStatus.Removed ? 'text-del' : 'text-mod'
          const key = tree.keys[i]
          const isIndex = key.startsWith('[')
          return (
            <div
              key={vi.key}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={container ? open : undefined}
              aria-selected={selected === i}
              onClick={() => onSelect(i)}
              onDoubleClick={() => container && onToggle(i)}
              className={cn(
                'absolute inset-x-0 flex h-6 cursor-default items-center whitespace-nowrap pr-4 hover:bg-surface-2/60',
                rowTone,
                selected === i && 'bg-accent-soft shadow-[inset_2px_0_0_var(--accent)] hover:bg-accent-soft',
              )}
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <span className={cn('w-5 shrink-0 text-center select-none', markerTone)}>{marker}</span>
              <span style={{ width: depth * 16 }} className="shrink-0" />
              <span className="flex size-4 shrink-0 items-center justify-center">
                {container && (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={open ? 'Collapse' : 'Expand'}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggle(i)
                    }}
                    className="rounded-sm text-subtle hover:text-fg"
                  >
                    <ChevronRight className={cn('size-3.5 transition-transform duration-100', open && 'rotate-90')} />
                  </button>
                )}
              </span>
              <span className={cn('ml-1 shrink-0', isIndex ? 'text-subtle' : 'text-[color:var(--json-key)]', i === 0 && 'text-subtle')}>{key}</span>
              {i !== 0 && <span className="shrink-0 text-subtle">:&nbsp;</span>}
              {i === 0 && <span className="shrink-0">&nbsp;</span>}
              <ValueCell st={st} lk={lk} rk={rk} lp={tree.leftPreview[i]} rp={tree.rightPreview[i]} />
              {container && count > 0 && st === NodeStatus.Contains && (
                <span className="ml-2 shrink-0 rounded-sm bg-surface-2 px-1.5 font-sans text-2xs text-muted tabular">
                  {formatNumber(count)} {count === 1 ? 'change' : 'changes'}
                </span>
              )}
              {st === NodeStatus.Ignored && <span className="ml-2 shrink-0 font-sans text-2xs text-subtle">ignored</span>}
              {st === NodeStatus.Elided && (
                <span className="ml-2 shrink-0 font-sans text-2xs text-subtle" title="Large unchanged subtrees are summarized to keep very big documents responsive.">
                  unchanged · not expanded
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})

function Val({ kind, text, strike }: { kind: string; text: string; strike?: boolean }) {
  return <span className={cn('truncate', valueClass[kind] ?? '', strike && 'line-through decoration-del/70')}>{text}</span>
}

function ValueCell({ st, lk, rk, lp, rp }: { st: number; lk: string; rk: string; lp: string; rp: string }) {
  if (st === NodeStatus.Added) return <Val kind={rk} text={rp} />
  if (st === NodeStatus.Removed) return <Val kind={lk} text={lp} strike />
  if (st === NodeStatus.Modified || st === NodeStatus.TypeChanged) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="rounded-[2px] bg-del-bg-strong/70 px-1">
          <Val kind={lk} text={lp} />
        </span>
        {st === NodeStatus.TypeChanged && <span className="font-sans text-2xs text-subtle">{lk}</span>}
        <span className="text-subtle">→</span>
        <span className="rounded-[2px] bg-add-bg-strong/70 px-1">
          <Val kind={rk} text={rp} />
        </span>
        {st === NodeStatus.TypeChanged && <span className="font-sans text-2xs text-mod">{rk}</span>}
      </span>
    )
  }
  return <Val kind={lk || rk} text={lp || rp} />
}
