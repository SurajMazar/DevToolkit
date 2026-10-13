import { cn } from '@/utils/cn'

export function StatusBar({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex h-7 shrink-0 items-center gap-4 overflow-x-auto whitespace-nowrap border-t border-border bg-bg px-3 text-2xs text-muted tabular [scrollbar-width:none] md:px-4', className)}
    >
      {children}
    </div>
  )
}

export function StatusItem({ label, children, tone, className }: { label?: string; children: React.ReactNode; tone?: 'add' | 'del' | 'mod' | 'danger' | 'ok' | 'accent'; className?: string }) {
  const toneClass = tone ? { add: 'text-add', del: 'text-del', mod: 'text-mod', danger: 'text-danger', ok: 'text-ok', accent: 'text-accent-text' }[tone] : ''
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {label && <span className="text-subtle">{label}</span>}
      <span className={cn('text-fg/85', toneClass)}>{children}</span>
    </span>
  )
}

export function StatusSpacer() {
  return <span className="flex-1" />
}
