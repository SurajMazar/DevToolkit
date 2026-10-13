import * as React from 'react'
import { ToggleGroup } from 'radix-ui'
import { cn } from '@/utils/cn'
import { Tooltip } from './tooltip'

export interface SegmentOption<T extends string> {
  value: T
  label: React.ReactNode
  icon?: React.ReactNode
  tooltip?: string
  disabled?: boolean
}

interface SegmentedProps<T extends string> {
  value: T
  onValueChange: (v: T) => void
  options: SegmentOption<T>[]
  className?: string
  size?: 'xs' | 'sm'
  /** Stretch to the container width with equal segments. */
  fullWidth?: boolean
  'aria-label': string
}

/** Single-choice segmented control (Radix ToggleGroup) — e.g. Side-by-side / Unified. */
export function Segmented<T extends string>({ value, onValueChange, options, className, size = 'sm', fullWidth, ...rest }: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={rest['aria-label']}
      className={cn('inline-flex shrink-0 items-center rounded-md border border-border bg-surface p-0.5 dark:bg-bg', size === 'sm' ? 'h-7' : 'h-6', fullWidth && 'flex w-full [&>*]:flex-1 [&>*]:justify-center', className)}
    >
      {options.map((o) => {
        const item = (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            aria-label={typeof o.label === 'string' ? o.label : o.tooltip}
            className={cn(
              'inline-flex h-full items-center gap-1.5 rounded-[4px] px-2 font-medium text-subtle transition-colors duration-120 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 aria-checked:bg-selected aria-checked:text-fg aria-checked:shadow-[0_1px_2px_rgb(0_0_0/0.10),0_0_0_0.5px_var(--border-strong)] aria-pressed:bg-selected aria-pressed:text-fg [&_svg]:size-3.5',
              size === 'sm' ? 'text-xs' : 'text-2xs',
            )}
          >
            {o.icon}
            {o.label}
          </ToggleGroup.Item>
        )
        return o.tooltip ? (
          <Tooltip key={o.value} content={o.tooltip}>
            {item}
          </Tooltip>
        ) : (
          item
        )
      })}
    </ToggleGroup.Root>
  )
}
