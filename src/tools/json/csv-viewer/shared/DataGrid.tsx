import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface GridColumn {
  name: string
  width: number
  /** Right-align (numbers). */
  numeric?: boolean
  /** Short type label shown under/next to the name. */
  hint?: string
}

export interface GridSort {
  col: number
  dir: 'asc' | 'desc'
}

export interface GridCell {
  row: number
  col: number
}

interface DataGridProps {
  columns: GridColumn[]
  rowCount: number
  /** Text for a cell. `null` renders as a muted "null"; `undefined` as an empty (missing) cell. */
  getCell: (row: number, col: number) => string | null | undefined
  /** Number shown in the gutter for a row (e.g. the original record number). */
  rowLabel?: (row: number) => number
  maxRowLabel?: number
  sort?: GridSort | null
  onSort?: (col: number) => void
  onResize?: (col: number, width: number) => void
  /** Extra header row (e.g. per-column filters). */
  renderFilter?: (col: number) => React.ReactNode
  selected?: GridCell | null
  onSelect?: (cell: GridCell) => void
  /** Enter / double-click on a cell. */
  onActivate?: (cell: GridCell) => void
  /** Scroll this column into view when it changes. */
  focusColumn?: { col: number; seq: number } | null
  empty?: React.ReactNode
  className?: string
  ariaLabel: string
}

const ROW_H = 28
const HEAD_H = 32
const FILTER_H = 34

/** Shows control characters visibly so multi-line values don't break the row. */
function display(v: string) {
  return v.length > 400 ? v.slice(0, 400).replace(/\r\n|\n|\r/g, ' ↵ ') + '…' : v.replace(/\r\n|\n|\r/g, ' ↵ ')
}

/**
 * Spreadsheet-style table virtualized in both directions: only the visible rows and
 * columns are in the DOM, so 100k × 100 tables scroll smoothly. Sticky header and
 * row-number gutter, sortable + resizable columns, keyboard cell navigation.
 */
export const DataGrid = memo(function DataGrid({
  columns,
  rowCount,
  getCell,
  rowLabel,
  maxRowLabel,
  sort,
  onSort,
  onResize,
  renderFilter,
  selected,
  onSelect,
  onActivate,
  focusColumn,
  empty,
  className,
  ariaLabel,
}: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const headH = HEAD_H + (renderFilter ? FILTER_H : 0)
  const gutter = Math.max(44, String(maxRowLabel ?? rowCount).length * 7.5 + 22)

  const rows = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
    paddingStart: headH,
    scrollPaddingStart: headH,
  })
  const cols = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => columns[i]?.width ?? 120,
    overscan: 3,
    paddingStart: gutter,
    scrollPaddingStart: gutter,
  })

  const widthsKey = columns.map((c) => c.width).join(',')
  useLayoutEffect(() => {
    cols.measure()
  }, [widthsKey, gutter, cols])

  useEffect(() => {
    if (focusColumn && focusColumn.col < columns.length) cols.scrollToIndex(focusColumn.col, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusColumn?.seq])

  const totalW = cols.getTotalSize()
  const totalH = rows.getTotalSize()
  const vRows = rows.getVirtualItems()
  const vCols = cols.getVirtualItems()

  const startResize = (e: React.PointerEvent, col: number) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = columns[col].width
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => onResize?.(col, Math.max(48, Math.min(900, startW + ev.clientX - startX)))
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!onSelect || !rowCount || !columns.length) return
    if ((e.target as HTMLElement).closest('input')) return
    const cur = selected ?? { row: 0, col: 0 }
    let { row, col } = cur
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 300) / ROW_H) - 2)
    switch (e.key) {
      case 'ArrowDown':
        row++
        break
      case 'ArrowUp':
        row--
        break
      case 'ArrowRight':
        col++
        break
      case 'ArrowLeft':
        col--
        break
      case 'PageDown':
        row += page
        break
      case 'PageUp':
        row -= page
        break
      case 'Home':
        if (e.ctrlKey || e.metaKey) row = 0
        col = 0
        break
      case 'End':
        if (e.ctrlKey || e.metaKey) row = rowCount - 1
        col = columns.length - 1
        break
      case 'Enter':
        if (selected) onActivate?.(selected)
        e.preventDefault()
        return
      default:
        return
    }
    e.preventDefault()
    row = Math.max(0, Math.min(rowCount - 1, row))
    col = Math.max(0, Math.min(columns.length - 1, col))
    onSelect({ row, col })
    rows.scrollToIndex(row)
    cols.scrollToIndex(col)
  }

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={rowCount + 1}
      aria-colcount={columns.length}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn('relative min-h-0 flex-1 overflow-auto bg-workspace text-[12.5px] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', className)}
    >
      <div style={{ width: totalW, height: Math.max(totalH, headH), position: 'relative' }}>
        {/* Header */}
        <div role="row" className="sticky top-0 z-20 border-b border-border-strong bg-bg" style={{ height: headH, width: totalW }}>
          <div className="sticky left-0 z-10 h-full border-r border-border bg-bg" style={{ width: gutter }} aria-hidden />
          {vCols.map((vc) => {
            const c = columns[vc.index]
            const active = sort?.col === vc.index
            return (
              <div key={vc.key} role="columnheader" aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined} className="absolute top-0 border-r border-border" style={{ left: vc.start, width: vc.size, height: headH }}>
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={!onSort}
                  onClick={() => onSort?.(vc.index)}
                  title={c.hint ? `${c.name} · ${c.hint}` : c.name}
                  className={cn('group flex w-full items-center gap-1.5 px-2 text-left text-xs font-medium text-fg enabled:hover:bg-surface-2/70', c.numeric && 'flex-row-reverse text-right')}
                  style={{ height: HEAD_H }}
                >
                  <span className="min-w-0 truncate">{c.name}</span>
                  {c.hint && <span className="shrink-0 text-2xs font-normal text-subtle">{c.hint}</span>}
                  {active ? (
                    sort!.dir === 'asc' ? (
                      <ArrowUp className="size-3 shrink-0 text-accent-text" aria-hidden />
                    ) : (
                      <ArrowDown className="size-3 shrink-0 text-accent-text" aria-hidden />
                    )
                  ) : (
                    onSort && <ArrowDown className="size-3 shrink-0 opacity-0 text-subtle group-hover:opacity-60" aria-hidden />
                  )}
                </button>
                {renderFilter && (
                  <div className="px-1 pb-1" style={{ height: FILTER_H }}>
                    {renderFilter(vc.index)}
                  </div>
                )}
                {onResize && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${c.name}`}
                    onPointerDown={(e) => startResize(e, vc.index)}
                    onDoubleClick={() => onResize(vc.index, -1)}
                    className="absolute -right-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize hover:bg-accent/50"
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Body */}
        {vRows.map((vr) => {
          const r = vr.index
          return (
            <div key={vr.key} role="row" aria-rowindex={r + 2} className="group/row absolute left-0" style={{ top: vr.start, height: ROW_H, width: totalW }}>
              <div
                className={cn('sticky left-0 z-10 flex h-full items-center justify-end border-b border-r border-border bg-bg pr-2 text-2xs text-subtle tabular', selected?.row === r && 'text-accent-text')}
                style={{ width: gutter }}
              >
                {rowLabel ? rowLabel(r) : r + 1}
              </div>
              {vCols.map((vc) => {
                const v = getCell(r, vc.index)
                const isSel = selected?.row === r && selected.col === vc.index
                const numeric = columns[vc.index]?.numeric
                return (
                  <div
                    key={vc.key}
                    role="gridcell"
                    aria-selected={isSel || undefined}
                    onMouseDown={onSelect ? () => onSelect({ row: r, col: vc.index }) : undefined}
                    onDoubleClick={onActivate ? () => onActivate({ row: r, col: vc.index }) : undefined}
                    className={cn(
                      'absolute top-0 flex h-full items-center overflow-hidden whitespace-pre border-b border-r border-border/70 px-2 group-hover/row:bg-surface-2/40',
                      numeric && 'justify-end tabular',
                      isSel && 'z-[1] bg-accent-soft outline outline-1 -outline-offset-1 outline-accent group-hover/row:bg-accent-soft',
                    )}
                    style={{ left: vc.start, width: vc.size }}
                  >
                    {v === null ? <span className="italic text-subtle">null</span> : v === undefined ? null : <span className="truncate">{display(v)}</span>}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      {rowCount === 0 && empty && <div className="pointer-events-none absolute inset-x-0 bottom-0 [&_button]:pointer-events-auto" style={{ top: headH }}>{empty}</div>}
    </div>
  )
})

/** Initial column width from the header and a sample of values. */
export function estimateWidth(name: string, sample: (string | null | undefined)[], extra = 0): number {
  let max = name.length + 2
  for (const v of sample) if (v && v.length > max) max = v.length
  return Math.round(Math.max(64, Math.min(320, max * 7.4 + 22 + extra)))
}
