import * as React from 'react'
import { Label as L } from 'radix-ui'
import { cn } from '@/utils/cn'

export function Label({ className, ...props }: React.ComponentProps<typeof L.Root>) {
  return <L.Root className={cn('text-xs font-medium text-muted select-none', className)} {...props} />
}

/** Label stacked above a control, with optional hint. */
export function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-2xs text-subtle">{hint}</p>}
    </div>
  )
}
