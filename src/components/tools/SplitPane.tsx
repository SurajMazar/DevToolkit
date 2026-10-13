import { Children, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/utils/cn'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Segmented } from '@/components/ui/segmented'

interface SplitPaneProps {
  /** horizontal = panes side by side; vertical = stacked. */
  direction?: 'horizontal' | 'vertical'
  /** Initial size of the first pane as a fraction (0–1). */
  initial?: number
  /** Minimum size for each pane in px. */
  min?: number
  /** Persist the ratio under this key. */
  id?: string
  className?: string
  children: [React.ReactNode, React.ReactNode]
  /** On phones, show one pane at a time behind these tab labels. */
  mobileTabs?: [string, string]
  mobileTab?: 0 | 1
  onMobileTabChange?: (i: 0 | 1) => void
}

const readRatio = (id: string | undefined, fallback: number) => {
  if (!id) return fallback
  try {
    const v = Number(localStorage.getItem(`devtoolkit:split:${id}`))
    return v > 0 && v < 1 ? v : fallback
  } catch {
    return fallback
  }
}

/** Resizable two-pane split with pointer and keyboard resizing. */
export function SplitPane({
  direction = 'horizontal',
  initial = 0.5,
  min = 160,
  id,
  className,
  children,
  mobileTabs,
  mobileTab,
  onMobileTabChange,
}: SplitPaneProps) {
  const [ratio, setRatio] = useState(() => readRatio(id, initial))
  const [dragging, setDragging] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const [localTab, setLocalTab] = useState<0 | 1>(0)
  const tab = mobileTab ?? localTab
  const setTab = onMobileTabChange ?? setLocalTab
  const horizontal = direction === 'horizontal'
  const [a, b] = Children.toArray(children) as [React.ReactNode, React.ReactNode]

  useEffect(() => {
    if (!id) return
    try {
      localStorage.setItem(`devtoolkit:split:${id}`, String(ratio))
    } catch {
      /* ignore */
    }
  }, [id, ratio])

  const clamp = useCallback(
    (r: number) => {
      const el = box.current
      if (!el) return r
      const total = horizontal ? el.clientWidth : el.clientHeight
      if (total <= min * 2) return 0.5
      const lo = min / total
      return Math.min(1 - lo, Math.max(lo, r))
    },
    [horizontal, min],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const el = box.current
    if (!el) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(true)
    const rect = el.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      const r = horizontal ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height
      setRatio(clamp(r))
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02
    const dec = horizontal ? 'ArrowLeft' : 'ArrowUp'
    const inc = horizontal ? 'ArrowRight' : 'ArrowDown'
    if (e.key === dec) setRatio((r) => clamp(r - step))
    else if (e.key === inc) setRatio((r) => clamp(r + step))
    else if (e.key === 'Home') setRatio(clamp(0))
    else if (e.key === 'End') setRatio(clamp(1))
    else if (e.key === 'Enter') setRatio(initial)
    else return
    e.preventDefault()
  }

  if (isMobile && mobileTabs) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <div className="flex shrink-0 items-center border-b border-border bg-bg px-3 py-1.5">
          <Segmented
            aria-label="Visible pane"
            value={String(tab)}
            onValueChange={(v) => setTab(Number(v) as 0 | 1)}
            options={[
              { value: '0', label: mobileTabs[0] },
              { value: '1', label: mobileTabs[1] },
            ]}
            className="w-full [&>*]:flex-1 [&>*]:justify-center"
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{tab === 0 ? a : b}</div>
      </div>
    )
  }

  return (
    <div ref={box} className={cn('flex min-h-0 min-w-0 flex-1', horizontal ? 'flex-row' : 'flex-col', dragging && 'select-none', className)}>
      <div className="flex min-h-0 min-w-0 flex-col" style={{ flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}>
        {a}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Resize panes"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => setRatio(initial)}
        className={cn(
          'group relative z-10 shrink-0 bg-border outline-none',
          horizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
        )}
      >
        <span
          className={cn(
            'absolute transition-colors duration-150 group-hover:bg-accent/60 group-focus-visible:bg-accent',
            dragging && 'bg-accent',
            horizontal ? 'inset-y-0 -left-[2px] w-[5px]' : 'inset-x-0 -top-[2px] h-[5px]',
          )}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{b}</div>
    </div>
  )
}
