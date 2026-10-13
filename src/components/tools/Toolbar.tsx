import { cn } from '@/utils/cn'

/** Compact, horizontally-scrollable action bar under the tool header. */
export function Toolbar({ className, children, 'aria-label': label = 'Tool actions' }: { className?: string; children: React.ReactNode; 'aria-label'?: string }) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn(
        'flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-bg px-3 py-1.5 [scrollbar-width:none] md:px-4 [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function ToolbarGroup({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex shrink-0 items-center gap-1', className)}>{children}</div>
}

export function ToolbarSeparator() {
  return <div aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
}

export function ToolbarSpacer() {
  return <div aria-hidden className="min-w-2 flex-1" />
}

/** Inline label + control pair inside a toolbar (e.g. "Indent [2 ▾]"). */
/**
 * Inline label + control pair. Renders a <label> by default; use `as="div"` when the
 * control is a group (e.g. Segmented) so the label isn't merged into its buttons' names.
 */
export function ToolbarField({ label, children, className, as = 'label' }: { label: string; children: React.ReactNode; className?: string; as?: 'label' | 'div' }) {
  const Comp = as
  return (
    <Comp className={cn('flex shrink-0 items-center gap-1.5 text-xs text-muted', className)} {...(as === 'div' ? { role: 'group', 'aria-label': label } : {})}>
      <span className="whitespace-nowrap" aria-hidden={as === 'div' || undefined}>{label}</span>
      {children}
    </Comp>
  )
}
