import { forwardRef, memo, useCallback, useImperativeHandle, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { NodeType, NODE_TYPE_NAMES, containerPreview, isContainer, type TreeIndex } from '@/engines/json-tools/tree'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'
import { Highlight, TYPE_CLASS, clip } from './values'

export const ROW_HEIGHT = 24
const INDENT = 16

export interface TreeViewHandle {
  scrollToRow: (row: number, align?: 'auto' | 'center') => void
  focus: () => void
}

interface TreeViewProps {
  tree: TreeIndex
  rows: Int32Array
  expanded: Uint8Array
  /** Bumps when `expanded` is mutated. */
  version: number
  selected: number
  onSelect: (node: number) => void
  onToggle: (node: number, recursive?: boolean) => void
  /** Set of node indices matching the search. */
  matchSet: Set<number> | null
  activeMatch: number
  query: string
  highlightKeys: boolean
  highlightValues: boolean
  dimmed?: boolean
}

export const TreeView = forwardRef<TreeViewHandle, TreeViewProps>(function TreeView(
  { tree, rows, expanded, version, selected, onSelect, onToggle, matchSet, activeMatch, query, highlightKeys, highlightValues, dimmed },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  })

  useImperativeHandle(ref, () => ({
    scrollToRow: (row: number, align: 'auto' | 'center' = 'auto') => virtualizer.scrollToIndex(row, { align }),
    focus: () => scroller.current?.focus({ preventScroll: true }),
  }))

  const rowOf = useCallback((node: number) => {
    // rows is sorted (pre-order), so binary search.
    let lo = 0
    let hi = rows.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const v = rows[mid]
      if (v === node) return mid
      if (v < node) lo = mid + 1
      else hi = mid - 1
    }
    return -1
  }, [rows])

  const move = (node: number) => {
    onSelect(node)
    const r = rowOf(node)
    if (r >= 0) virtualizer.scrollToIndex(r, { align: 'auto' })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = rowOf(selected)
    const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? 400) / ROW_HEIGHT) - 1)
    const container = isContainer(tree, selected)
    const open = container && expanded[selected] === 1
    switch (e.key) {
      case 'ArrowDown':
        if (r < rows.length - 1) move(rows[r + 1])
        break
      case 'ArrowUp':
        if (r > 0) move(rows[r - 1])
        break
      case 'PageDown':
        move(rows[Math.min(rows.length - 1, r + page)])
        break
      case 'PageUp':
        move(rows[Math.max(0, r - page)])
        break
      case 'Home':
        move(rows[0])
        break
      case 'End':
        move(rows[rows.length - 1])
        break
      case 'ArrowRight':
        if (container && !open && tree.childCount[selected] > 0) onToggle(selected, e.altKey)
        else if (open && tree.childCount[selected] > 0) move(selected + 1)
        break
      case 'ArrowLeft':
        if (open) onToggle(selected, e.altKey)
        else if (tree.parent[selected] >= 0) move(tree.parent[selected])
        break
      case 'Enter':
      case ' ':
        if (container && tree.childCount[selected] > 0) onToggle(selected, e.altKey)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const items = virtualizer.getVirtualItems()

  return (
    <div
      ref={scroller}
      role="tree"
      aria-label="JSON tree"
      aria-activedescendant={`tn-${selected}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn('relative h-full overflow-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', dimmed && 'opacity-55')}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: '100%' }} className="w-max">
        {items.map((it) => {
          const node = rows[it.index]
          return (
            <Row
              key={node}
              node={node}
              top={it.start}
              tree={tree}
              open={expanded[node] === 1}
              version={version}
              selected={node === selected}
              match={matchSet?.has(node) ?? false}
              active={node === activeMatch}
              query={query}
              highlightKeys={highlightKeys}
              highlightValues={highlightValues}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          )
        })}
      </div>
    </div>
  )
})

interface RowProps {
  node: number
  top: number
  tree: TreeIndex
  open: boolean
  version: number
  selected: boolean
  match: boolean
  active: boolean
  query: string
  highlightKeys: boolean
  highlightValues: boolean
  onSelect: (n: number) => void
  onToggle: (n: number, recursive?: boolean) => void
}

const Row = memo(function Row({ node, top, tree, open, selected, match, active, query, highlightKeys, highlightValues, onSelect, onToggle }: RowProps) {
  const type = tree.type[node]
  const typeName = NODE_TYPE_NAMES[type]
  const container = type <= NodeType.Array
  const count = tree.childCount[node]
  const depth = tree.depth[node]
  const isRoot = node === 0
  const isIdx = tree.isIndex[node] === 1
  const key = tree.keys[node]
  const q = match ? query : ''

  return (
    <div
      id={`tn-${node}`}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={container && count > 0 ? open : undefined}
      aria-selected={selected}
      onMouseDown={(e) => {
        // Keep focus on the tree container for keyboard navigation.
        if (e.detail > 1) e.preventDefault()
      }}
      onClick={(e) => {
        onSelect(node)
        if (container && count > 0 && (e.target as HTMLElement).closest('[data-chevron]')) onToggle(node, e.altKey)
      }}
      onDoubleClick={() => container && count > 0 && onToggle(node)}
      className={cn(
        'mono absolute left-0 flex w-full cursor-default items-center whitespace-pre pr-4 text-[12.5px] leading-6 hover:bg-surface-2/60',
        selected && 'bg-accent-soft hover:bg-accent-soft',
        active && 'shadow-[inset_2px_0_0_var(--accent)]',
      )}
      style={{ top, height: ROW_HEIGHT, paddingLeft: 8 + depth * INDENT }}
    >
      {/* indent guides */}
      {depth > 0 &&
        Array.from({ length: depth }, (_, d) => <span key={d} aria-hidden className="absolute inset-y-0 w-px bg-border/70" style={{ left: 8 + d * INDENT + 7 }} />)}
      <span data-chevron className={cn('mr-0.5 flex size-4 shrink-0 items-center justify-center text-subtle', container && count > 0 ? 'hover:text-fg' : 'invisible')}>
        <ChevronRight className={cn('size-3.5 transition-transform duration-100', open && 'rotate-90')} />
      </span>
      {isRoot ? (
        <span className="text-subtle">$</span>
      ) : isIdx ? (
        <span className="text-subtle tabular">{key}</span>
      ) : (
        <span className="text-fg">{highlightKeys ? <Highlight text={clip(key, 200)} query={q} active={active} /> : clip(key, 200)}</span>
      )}
      <span className="text-subtle">{': '}</span>
      {container ? (
        <span className="text-subtle">
          {type === NodeType.Array ? '[' : '{'}
          {open && count > 0 ? '' : count > 0 ? '…' : ''}
          {(!open || count === 0) && (type === NodeType.Array ? ']' : '}')}
          <span className="ml-2 font-sans text-2xs tabular">
            {formatNumber(count)} {type === NodeType.Array ? (count === 1 ? 'item' : 'items') : count === 1 ? 'key' : 'keys'}
          </span>
          {!open && type === NodeType.Object && count > 0 && <span className="ml-2 text-2xs text-subtle/80">{containerPreview(tree, node, 4)}</span>}
        </span>
      ) : (
        <span className={TYPE_CLASS[typeName]}>
          {highlightValues ? (
            <Highlight text={type === NodeType.String ? JSON.stringify(clip(tree.values[node])) : tree.values[node]} query={q} active={active} />
          ) : type === NodeType.String ? (
            JSON.stringify(clip(tree.values[node]))
          ) : (
            tree.values[node]
          )}
        </span>
      )}
    </div>
  )
})
