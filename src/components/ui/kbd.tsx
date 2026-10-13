import { cn } from '@/utils/cn'

export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-border bg-surface px-1 font-sans text-[10.5px] font-medium leading-none text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
