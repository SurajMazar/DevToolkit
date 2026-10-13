import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { copyText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'

/**
 * Dense, virtualized list of generated values (IDs, tokens…). Clicking a row copies it.
 * Handles 10k+ rows without rendering them all.
 */
export function ValueList({
  values,
  label,
  meta,
  actions,
  rowHeight = 30,
  className,
  mask,
}: {
  values: string[]
  label: string
  /** Optional secondary text per row (e.g. decoded timestamp). */
  meta?: (index: number) => React.ReactNode
  /** Extra per-row buttons, shown on hover/focus. */
  actions?: (index: number) => React.ReactNode
  rowHeight?: number
  className?: string
  /** Render values masked (e.g. hidden passwords). Copy still copies the real value. */
  mask?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // Reset the "copied" marker when the list is regenerated.
  useEffect(() => setCopied(null), [values])

  const v = useVirtualizer({ count: values.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowHeight, overscan: 12 })
  const digits = String(values.length).length

  const copy = async (i: number) => {
    const ok = await copyText(values[i])
    if (!ok) {
      toast.error('Clipboard access was blocked by the browser')
      return
    }
    setCopied(i)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(null), 1200)
  }

  return (
    <div ref={scrollRef} className={cn('min-h-0 flex-1 overflow-y-auto', className)} role="list" aria-label={label}>
      <div className="relative w-full" style={{ height: v.getTotalSize() + 8 }}>
        {v.getVirtualItems().map((item) => {
          const i = item.index
          const isCopied = copied === i
          return (
            <div
              key={item.key}
              role="listitem"
              className="group absolute inset-x-0 flex items-center gap-3 px-3"
              style={{ top: item.start + 4, height: item.size }}
            >
              <span className="w-[var(--w)] shrink-0 text-right text-2xs text-subtle tabular select-none" style={{ ['--w' as string]: `${Math.max(2, digits) * 7 + 2}px` }}>
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => copy(i)}
                title="Click to copy"
                className={cn(
                  'mono flex h-[26px] min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] text-fg transition-colors duration-100 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  isCopied && 'bg-ok-soft hover:bg-ok-soft',
                )}
              >
                <span className="min-w-0 shrink-0 truncate max-w-full">{mask ? '•'.repeat(Math.min(values[i].length, 48)) : values[i]}</span>
                {meta && !isCopied && <span className="ml-auto hidden min-w-0 truncate pl-2 font-sans text-2xs text-subtle tabular sm:inline sm:group-hover:hidden sm:group-focus-within:hidden">{meta(i)}</span>}
                <span
                  className={cn(
                    'ml-auto shrink-0 items-center gap-1 pl-2 font-sans text-2xs',
                    isCopied ? 'flex text-ok' : meta ? 'hidden text-subtle group-hover:flex group-focus-within:flex' : 'flex text-subtle opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                  )}
                >
                  {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {isCopied ? 'Copied' : meta ? 'Copy' : null}
                </span>
              </button>
              {actions && <div className="flex shrink-0 items-center opacity-60 group-hover:opacity-100 group-focus-within:opacity-100">{actions(i)}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
