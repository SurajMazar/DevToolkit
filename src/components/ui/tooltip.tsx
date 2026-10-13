import * as React from 'react'
import { Tooltip as T } from 'radix-ui'
import { cn } from '@/utils/cn'
import { Kbd } from './kbd'

export const TooltipProvider = T.Provider

interface TooltipProps {
  content: React.ReactNode
  shortcut?: string[]
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  children: React.ReactElement
  disabled?: boolean
}

export function Tooltip({ content, shortcut, side = 'bottom', align = 'center', children, disabled }: TooltipProps) {
  if (disabled || !content) return children
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-50 flex max-w-72 items-center gap-2 rounded-md border border-border-strong bg-raised px-2 py-1 text-xs text-fg shadow-pop animate-pop-in',
          )}
        >
          <span>{content}</span>
          {shortcut && (
            <span className="flex gap-0.5">
              {shortcut.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          )}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
