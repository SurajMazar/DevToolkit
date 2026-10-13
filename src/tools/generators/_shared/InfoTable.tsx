import { cn } from '@/utils/cn'

export interface InfoRow {
  key: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  action?: React.ReactNode
  /** Render the value in the sans font (labels, prose) instead of monospace. */
  sans?: boolean
  tone?: 'ok' | 'danger' | 'warn' | 'muted'
}

/**
 * Compact key/value table for narrow inspector panels: a fixed, narrow key column so
 * 36-character IDs fit on one line, and values that break at any character if needed.
 */
export function InfoTable({ rows, className, keyWidth = 'w-[84px]' }: { rows: InfoRow[]; className?: string; keyWidth?: string }) {
  return (
    <dl className={cn('divide-y divide-border overflow-hidden rounded-lg border border-border', className)}>
      {rows.map((r, i) => (
        <div key={i} className="group flex items-start">
          <dt className={cn('shrink-0 self-stretch bg-surface/60 px-2.5 py-1.5 text-xs font-medium text-muted', keyWidth)}>
            {r.key}
            {r.hint && <span className="block text-2xs font-normal text-subtle">{r.hint}</span>}
          </dt>
          <dd className="flex min-w-0 flex-1 items-start gap-1 py-1.5 pl-2.5 pr-1">
            <div
              className={cn(
                'min-w-0 flex-1 py-px',
                r.sans ? 'text-sm' : 'mono break-all text-[12px] leading-[18px]',
                r.tone === 'ok' && 'text-ok',
                r.tone === 'danger' && 'text-danger',
                r.tone === 'warn' && 'text-warn',
                r.tone === 'muted' && 'text-subtle',
              )}
            >
              {r.value}
            </div>
            {r.action && <div className="-my-0.5 shrink-0 opacity-60 group-hover:opacity-100 focus-within:opacity-100">{r.action}</div>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
