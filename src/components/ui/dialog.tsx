import * as React from 'react'
import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({
  className,
  children,
  title,
  description,
  hideClose,
  ...props
}: React.ComponentProps<typeof D.Content> & { title: React.ReactNode; description?: React.ReactNode; hideClose?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 animate-fade-in dark:bg-black/60" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 flex-col rounded-xl border border-border-strong bg-raised shadow-pop outline-none animate-pop-in',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</D.Description>
            )}
          </div>
          {!hideClose && (
            <D.Close className="-mr-1 rounded-sm p-1 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          )}
        </div>
        <div className="min-h-0 overflow-auto">{children}</div>
      </D.Content>
    </D.Portal>
  )
}
