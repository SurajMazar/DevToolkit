import * as React from 'react'
import { Select as S } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface SelectOption<T extends string = string> {
  value: T
  label: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
}

interface SelectProps<T extends string> {
  value: T
  onValueChange: (v: T) => void
  options: SelectOption<T>[] | { label: string; options: SelectOption<T>[] }[]
  placeholder?: string
  className?: string
  size?: 'sm' | 'md'
  'aria-label'?: string
  prefix?: React.ReactNode
  disabled?: boolean
  id?: string
}

function isGrouped<T extends string>(o: SelectProps<T>['options']): o is { label: string; options: SelectOption<T>[] }[] {
  return o.length > 0 && 'options' in o[0]
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  size = 'sm',
  prefix,
  disabled,
  id,
  ...rest
}: SelectProps<T>) {
  const renderItem = (o: SelectOption<T>) => (
    <S.Item
      key={o.value}
      value={o.value}
      disabled={o.disabled}
      className="relative flex cursor-default select-none items-start gap-2 rounded-sm py-1.5 pl-7 pr-3 text-sm text-fg outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2"
    >
      <S.ItemIndicator className="absolute left-2 top-[7px]">
        <Check className="size-3.5 text-accent-text" />
      </S.ItemIndicator>
      <div className="flex flex-col">
        <S.ItemText>{o.label}</S.ItemText>
        {o.description && <span className="text-xs text-subtle">{o.description}</span>}
      </div>
    </S.Item>
  )
  return (
    <S.Root value={value} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
      <S.Trigger
        id={id}
        aria-label={rest['aria-label']}
        className={cn(
          'inline-flex min-w-0 items-center justify-between gap-1.5 rounded-md border border-border bg-raised px-2.5 text-sm text-fg shadow-[0_1px_0_rgb(0_0_0/0.03)] transition-colors duration-120 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50 data-[placeholder]:text-subtle dark:bg-surface',
          size === 'sm' ? 'h-7' : 'h-8',
          className,
        )}
      >
        {prefix && <span className="text-subtle">{prefix}</span>}
        <span className="truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon>
          <ChevronDown className="size-3.5 text-subtle" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-[min(var(--radix-select-content-available-height),360px)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border-strong bg-raised shadow-pop animate-pop-in"
        >
          <S.Viewport className="p-1">
            {isGrouped(options)
              ? options.map((g, i) => (
                  <S.Group key={g.label}>
                    {i > 0 && <S.Separator className="mx-1 my-1 h-px bg-border" />}
                    <S.Label className="px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wider text-subtle">{g.label}</S.Label>
                    {g.options.map(renderItem)}
                  </S.Group>
                ))
              : (options as SelectOption<T>[]).map(renderItem)}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}

/** Native select — used for very long lists (timezones) where a native picker is faster. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className={cn('relative inline-flex min-w-0', className)}>
      <select
        ref={ref}
        className="h-8 w-full min-w-0 appearance-none rounded-md border border-border bg-raised py-0 pl-2.5 pr-7 text-sm text-fg transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft dark:bg-surface"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
    </div>
  ),
)
NativeSelect.displayName = 'NativeSelect'
