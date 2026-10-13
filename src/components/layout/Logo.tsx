import { cn } from '@/utils/cn'

/** DevToolkit mark: three offset text lines — the middle one "changed". */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cn('size-5', className)} aria-hidden>
      <rect x="0.5" y="0.5" width="19" height="19" rx="5" className="fill-fg" />
      <rect x="4" y="5.2" width="8.2" height="2" rx="1" className="fill-bg" />
      <rect x="6.6" y="9" width="9.4" height="2" rx="1" className="fill-accent" />
      <rect x="4" y="12.8" width="5.6" height="2" rx="1" className="fill-bg opacity-55" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-[14px] font-semibold tracking-[-0.01em] text-fg">
        DevToolkit
      </span>
    </span>
  )
}
