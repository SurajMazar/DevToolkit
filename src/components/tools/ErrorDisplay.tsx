import { AlertCircle, CornerDownRight, TriangleAlert } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/button'

export interface DisplayError {
  message: string
  line?: number
  column?: number
  detail?: string
}

/** Inline, actionable error strip. Errors are explicit — never silently swallowed. */
export function ErrorDisplay({
  error,
  title,
  onLocate,
  severity = 'error',
  className,
  action,
}: {
  error: DisplayError | string
  title?: string
  onLocate?: (line: number, column?: number) => void
  severity?: 'error' | 'warning'
  className?: string
  action?: React.ReactNode
}) {
  const e = typeof error === 'string' ? { message: error } : error
  const Icon = severity === 'error' ? AlertCircle : TriangleAlert
  return (
    <div
      role="alert"
      className={cn(
        'flex shrink-0 items-start gap-2.5 border-b px-3 py-2 text-sm',
        severity === 'error' ? 'border-danger/25 bg-danger-soft text-fg' : 'border-warn/25 bg-warn-soft text-fg',
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', severity === 'error' ? 'text-danger' : 'text-warn')} />
      <div className="min-w-0 flex-1">
        <p className="break-words">
          {title && <span className="font-medium">{title}: </span>}
          {e.message}
          {e.line != null && (
            <span className="ml-1.5 text-muted tabular">
              (line {e.line}
              {e.column != null && `, column ${e.column}`})
            </span>
          )}
        </p>
        {e.detail && <pre className="mono mt-1 overflow-x-auto whitespace-pre text-xs text-muted">{e.detail}</pre>}
      </div>
      {onLocate && e.line != null && (
        <Button size="xs" variant="ghost" className="-my-0.5 text-fg" onClick={() => onLocate(e.line!, e.column)}>
          <CornerDownRight /> Go to
        </Button>
      )}
      {action}
    </div>
  )
}
