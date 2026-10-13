import * as React from 'react'
import { Tabs as T } from 'radix-ui'
import { cn } from '@/utils/cn'

export const Tabs = T.Root

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn('flex h-9 shrink-0 items-stretch gap-4 border-b border-border px-3', className)} {...props} />
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'relative inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-muted transition-colors duration-120 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[state=active]:text-fg after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:rounded-full after:bg-transparent data-[state=active]:after:bg-accent [&_svg]:size-3.5',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof T.Content>) {
  return <T.Content className={cn('min-h-0 outline-none', className)} {...props} />
}
