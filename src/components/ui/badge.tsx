import { cn } from '@/utils/cn'

const tones = {
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent-soft text-accent-text',
  add: 'bg-add-bg text-add',
  del: 'bg-del-bg text-del',
  mod: 'bg-mod-bg text-mod',
  danger: 'bg-danger-soft text-danger',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
} as const

export function Badge({
  tone = 'neutral',
  className,
  children,
  title,
}: {
  tone?: keyof typeof tones
  className?: string
  children: React.ReactNode
  title?: string
}) {
  return (
    <span title={title} className={cn('inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm px-1.5 text-2xs font-medium tabular-nums', tones[tone], className)}>
      {children}
    </span>
  )
}
