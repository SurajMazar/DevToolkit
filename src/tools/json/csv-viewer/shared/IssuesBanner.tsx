import { useState } from 'react'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Button } from '@/components/ui/button'

export interface BannerIssue {
  severity: 'error' | 'warning'
  message: string
  line?: number
  column?: number
  row?: number
}

/**
 * Shows the most important issue with a "Go to" action, and the rest behind a toggle.
 * Errors come before warnings. Nothing is hidden silently: the count is always visible.
 */
export function IssuesBanner({ issues, onLocate, rowLabel = 'row' }: { issues: BannerIssue[]; onLocate?: (line: number, column?: number) => void; rowLabel?: string }) {
  const [open, setOpen] = useState(false)
  if (!issues.length) return null
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  const shown = open ? sorted : sorted.slice(0, 1)
  const more = sorted.length - 1
  return (
    <div className="max-h-[40%] shrink-0 overflow-y-auto">
      {shown.map((i, n) => (
        <ErrorDisplay
          key={n}
          severity={i.severity}
          error={{ message: i.row != null && i.line == null ? `${i.message} (${rowLabel} ${i.row})` : i.message, line: i.line, column: i.column }}
          onLocate={onLocate}
          action={
            n === 0 && more > 0 ? (
              <Button size="xs" variant="ghost" className="-my-0.5 text-fg" onClick={() => setOpen(!open)}>
                {open ? 'Show less' : `+${more} more`}
              </Button>
            ) : undefined
          }
        />
      ))}
    </div>
  )
}
