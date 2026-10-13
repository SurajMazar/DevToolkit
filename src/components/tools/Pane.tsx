import { cn } from '@/utils/cn'

/** A flush workspace region: caption row + body. Panes are separated by borders, not cards. */
export function Pane({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-1 flex-col bg-workspace', className)} {...rest}>
      {children}
    </section>
  )
}

export function PaneHeader({
  title,
  meta,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <header className={cn('flex h-9 shrink-0 items-center gap-2 border-b border-border bg-workspace pl-3 pr-1.5', className)}>
      {title && <h2 className="eyebrow shrink-0">{title}</h2>}
      {meta && <div className="min-w-0 truncate text-2xs text-subtle tabular">{meta}</div>}
      {children}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>
    </header>
  )
}

export function PaneBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('relative min-h-0 flex-1', className)}>{children}</div>
}

export function PaneFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <footer className={cn('flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 text-2xs text-subtle tabular', className)}>{children}</footer>
}
