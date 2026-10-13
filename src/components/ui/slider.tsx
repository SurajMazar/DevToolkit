import * as React from 'react'
import { Slider as S } from 'radix-ui'
import { cn } from '@/utils/cn'

export function Slider({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  const count = (props.value ?? props.defaultValue ?? [0]).length
  return (
    <S.Root className={cn('relative flex h-5 w-full touch-none select-none items-center', className)} {...props}>
      <S.Track className="relative h-1 grow overflow-hidden rounded-full bg-surface-2">
        <S.Range className="absolute h-full bg-accent" />
      </S.Track>
      {Array.from({ length: count }, (_, i) => (
        <S.Thumb
          key={i}
          aria-label={props['aria-label']}
          className="block size-3.5 rounded-full border border-border-strong bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-shadow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-soft"
        />
      ))}
    </S.Root>
  )
}
