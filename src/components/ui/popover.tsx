import * as React from 'react'
import { Popover as P } from 'radix-ui'
import { cn } from '@/utils/cn'

export const Popover = P.Root
export const PopoverTrigger = P.Trigger
export const PopoverAnchor = P.Anchor
export const PopoverClose = P.Close

export function PopoverContent({ className, align = 'start', sideOffset = 6, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn('z-50 rounded-lg border border-border-strong bg-raised p-3 text-sm shadow-pop outline-none animate-pop-in', className)}
        {...props}
      />
    </P.Portal>
  )
}
