import * as React from 'react'
import { DropdownMenu as D } from 'radix-ui'
import { Check } from 'lucide-react'
import { cn } from '@/utils/cn'

export const DropdownMenu = D.Root
export const DropdownMenuTrigger = D.Trigger
export const DropdownMenuGroup = D.Group

export function DropdownMenuContent({ className, sideOffset = 4, align = 'end', ...props }: React.ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn('z-50 min-w-44 rounded-lg border border-border-strong bg-raised p-1 shadow-pop animate-pop-in', className)}
        {...props}
      />
    </D.Portal>
  )
}

const itemClass =
  'relative flex h-7 cursor-default select-none items-center gap-2 rounded-sm px-2 text-sm text-fg outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2 [&_svg]:size-3.5 [&_svg]:text-muted'

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof D.Item>) {
  return <D.Item className={cn(itemClass, className)} {...props} />
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof D.CheckboxItem>) {
  return (
    <D.CheckboxItem className={cn(itemClass, 'pl-7', className)} {...props}>
      <D.ItemIndicator className="absolute left-2">
        <Check className="!text-accent-text" />
      </D.ItemIndicator>
      {children}
    </D.CheckboxItem>
  )
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof D.Label>) {
  return <D.Label className={cn('px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wider text-subtle', className)} {...props} />
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <D.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} />
}

export function DropdownMenuShortcut({ children }: { children: React.ReactNode }) {
  return <span className="ml-auto pl-4 text-xs text-subtle">{children}</span>
}
