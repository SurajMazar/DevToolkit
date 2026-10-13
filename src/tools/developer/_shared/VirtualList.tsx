import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/utils/cn'

export interface VirtualListHandle {
  scrollToIndex: (index: number) => void
}

interface VirtualListProps<T> {
  items: readonly T[]
  /** Estimated row height in px (rows are measured after render). */
  estimateSize: number
  renderItem: (item: T, index: number) => React.ReactNode
  getKey?: (item: T, index: number) => string | number
  /** Non-virtualised content above the rows, scrolling with them. */
  header?: React.ReactNode
  /** Content below the rows (e.g. a cap notice). */
  footer?: React.ReactNode
  className?: string
  overscan?: number
  'aria-label'?: string
  role?: string
}

function VirtualListInner<T>(
  { items, estimateSize, renderItem, getKey, header, footer, className, overscan = 8, role, ...rest }: VirtualListProps<T>,
  ref: React.ForwardedRef<VirtualListHandle>,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [margin, setMargin] = useState(0)

  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) {
      setMargin(0)
      return
    }
    const update = () => setMargin(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [header])

  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin: margin,
    getItemKey: getKey ? (i) => getKey(items[i], i) : undefined,
  })

  useImperativeHandle(ref, () => ({ scrollToIndex: (i: number) => v.scrollToIndex(i, { align: 'auto' }) }), [v])

  // Re-measure when the data identity changes so stale heights don't linger.
  useEffect(() => {
    v.measure()
  }, [items, v])

  return (
    <div ref={scrollRef} className={cn('min-h-0 flex-1 overflow-y-auto', className)}>
      {header && <div ref={headerRef}>{header}</div>}
      <div role={role} aria-label={rest['aria-label']} style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={v.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start - margin}px)` }}
          >
            {renderItem(items[vi.index], vi.index)}
          </div>
        ))}
      </div>
      {footer}
    </div>
  )
}

/** Virtualised, variable-height list with optional non-virtual header/footer in the same scroller. */
export const VirtualList = forwardRef(VirtualListInner) as <T>(p: VirtualListProps<T> & { ref?: React.Ref<VirtualListHandle> }) => React.ReactElement
