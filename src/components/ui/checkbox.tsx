import * as React from 'react'
import { Checkbox as C } from 'radix-ui'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/utils/cn'

interface CheckboxProps extends Omit<React.ComponentProps<typeof C.Root>, 'children'> {
  label?: React.ReactNode
  description?: React.ReactNode
}

export function Checkbox({ className, label, description, id, ...props }: CheckboxProps) {
  const autoId = React.useId()
  const cid = id ?? autoId
  const box = (
    <C.Root
      id={cid}
      className={cn(
        'peer mt-px flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-workspace transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-fg',
        className,
      )}
      {...props}
    >
      <C.Indicator>
        {props.checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </C.Indicator>
    </C.Root>
  )
  if (!label) return box
  return (
    <label htmlFor={cid} className="flex cursor-default select-none items-start gap-2 text-sm text-fg">
      {box}
      <span className="flex flex-col">
        <span className={cn('leading-[18px]', !description && 'whitespace-nowrap')}>{label}</span>
        {description && <span className="text-xs text-subtle">{description}</span>}
      </span>
    </label>
  )
}
