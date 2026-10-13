import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import { useUI } from '@/stores/ui'
import { SidebarContent } from './Sidebar'
import { Wordmark } from './Logo'

export function MobileNav() {
  const open = useUI((s) => s.mobileNavOpen)
  const setOpen = useUI((s) => s.setMobileNavOpen)
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 animate-fade-in md:hidden" />
        <D.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)] flex-col border-r border-border bg-bg shadow-pop outline-none animate-slide-in-left md:hidden">
          <D.Title className="sr-only">Navigation</D.Title>
          <D.Description className="sr-only">Browse all tools by category</D.Description>
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
            <Wordmark />
            <D.Close className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close navigation">
              <X className="size-4" />
            </D.Close>
          </div>
          <SidebarContent collapsed={false} onNavigate={() => setOpen(false)} />
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
