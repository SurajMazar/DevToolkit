import { useEffect, useRef, useState } from 'react'
import { Check, Lock, LockOpen } from 'lucide-react'
import { toast } from 'sonner'
import { bestTextColor, contrast, formatValue, type Swatch, type ValueFormat } from '@/engines/generators/color'
import { IconButton } from '@/components/ui/icon-button'
import { copyText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'

function ContrastChip({ swatch, text }: { swatch: string; text: '#ffffff' | '#000000' }) {
  const c = contrast(text, swatch)
  const pass = c.level !== 'Fail'
  return (
    <span className="flex min-w-0 items-center gap-1" title={`${text === '#ffffff' ? 'White' : 'Black'} text on this color: ${c.ratio.toFixed(2)}:1 — ${c.level === 'Fail' ? 'fails WCAG AA' : `passes ${c.level}`}`}>
      {/* User-chosen colors: inline styles are the point here. */}
      <span className="flex h-[18px] w-6 shrink-0 items-center justify-center rounded-xs border border-border text-[10px] font-semibold" style={{ background: swatch, color: text }}>
        Aa
      </span>
      <span className="text-2xs text-muted tabular">{c.ratio.toFixed(1)}</span>
      <span className={cn('text-2xs font-medium', pass ? (c.level === 'AA Large' ? 'text-warn' : 'text-ok') : 'text-subtle')}>{c.level === 'AA Large' ? 'Large' : c.level}</span>
    </span>
  )
}

export function SwatchCard({ swatch, valueFormat, tall, locked, onToggleLock }: { swatch: Swatch; valueFormat: ValueFormat; tall?: boolean; locked?: boolean; onToggleLock?: () => void }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const value = formatValue(swatch.hex, valueFormat)
  const fg = bestTextColor(swatch.hex)

  const copy = async () => {
    if (!(await copyText(value))) {
      toast.error('Clipboard access was blocked by the browser')
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className={cn('flex min-w-0 flex-col overflow-hidden rounded-md border', swatch.isBase ? 'border-border-strong' : 'border-border')}>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${swatch.label} ${value}`}
        className={cn('relative flex w-full items-end justify-between p-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', tall ? 'h-32' : 'h-20')}
        style={{ background: swatch.hex, color: fg }}
      >
        {swatch.isBase && swatch.label !== 'Base' && <span className="text-2xs font-medium opacity-80">Base</span>}
        {copied && (
          <span className="ml-auto flex items-center gap-1 text-2xs font-medium">
            <Check className="size-3.5" /> Copied
          </span>
        )}
      </button>
      <div className="flex flex-col gap-1 bg-workspace px-2 py-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-xs font-medium text-fg">{swatch.label}</span>
          {onToggleLock && (
            <IconButton
              label={locked ? 'Unlock swatch' : 'Lock swatch'}
              aria-pressed={locked}
              size="icon-xs"
              className={cn('-my-1 -mr-1', locked && 'bg-accent-soft text-accent-text hover:bg-accent-soft')}
              icon={locked ? <Lock /> : <LockOpen />}
              onClick={onToggleLock}
            />
          )}
        </div>
        <span className="mono truncate text-[12px] leading-4 text-muted" title={value}>
          {value}
        </span>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
          <ContrastChip swatch={swatch.hex} text="#ffffff" />
          <ContrastChip swatch={swatch.hex} text="#000000" />
        </div>
      </div>
    </div>
  )
}
