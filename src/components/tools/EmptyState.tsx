import { cn } from '@/utils/cn'

/** Purpose-written empty state: what to do next, plus the actions to do it. */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
  compact,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cn('flex h-full w-full flex-col items-center justify-center px-6 text-center', compact ? 'gap-2 py-6' : 'gap-3 py-10', className)}>
      {icon && <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-subtle [&_svg]:size-[18px]">{icon}</div>}
      <div className="max-w-sm">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  )
}
