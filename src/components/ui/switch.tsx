import * as React from 'react'
import { Switch as S } from 'radix-ui'
import { cn } from '@/utils/cn'

interface SwitchProps extends Omit<React.ComponentProps<typeof S.Root>, 'children'> {
  label?: React.ReactNode
}

export function Switch({ className, label, id, ...props }: SwitchProps) {
  const autoId = React.useId()
  const switchId = id ?? autoId
  const control = (
    <S.Root
      id={switchId}
      className={cn(
        'peer relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full border border-transparent bg-border-strong transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 data-[state=checked]:bg-accent',
        className,
      )}
      {...props}
    >
      <S.Thumb className="pointer-events-none block size-3.5 translate-x-px rounded-full bg-white shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[13px]" />
    </S.Root>
  )
  if (!label) return control
  return (
    <label htmlFor={switchId} className="inline-flex cursor-default select-none items-center gap-2 text-sm text-fg">
      {control}
      <span>{label}</span>
    </label>
  )
}
