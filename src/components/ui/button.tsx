import * as React from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/utils/cn'

export const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow] duration-120 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover active:brightness-95',
        secondary:
          'border border-border bg-raised text-fg shadow-[0_1px_0_rgb(0_0_0/0.03)] hover:border-border-strong hover:bg-surface active:bg-surface-2 dark:bg-surface dark:hover:bg-surface-2',
        ghost: 'text-muted hover:bg-surface-2 hover:text-fg active:bg-surface-2 data-[state=open]:bg-surface-2 data-[state=open]:text-fg',
        subtle: 'bg-surface text-fg hover:bg-surface-2',
        danger: 'text-danger hover:bg-danger-soft',
        link: 'h-auto px-0 text-accent-text underline-offset-2 hover:underline',
      },
      size: {
        xs: 'h-6 px-2 text-xs [&_svg]:size-3.5',
        sm: 'h-7 px-2.5 text-sm [&_svg]:size-3.5',
        md: 'h-8 px-3 text-sm [&_svg]:size-4',
        lg: 'h-9 px-4 text-sm [&_svg]:size-4',
        icon: 'size-8 [&_svg]:size-4',
        'icon-sm': 'size-7 [&_svg]:size-[15px]',
        'icon-xs': 'size-6 rounded-sm [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'sm' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, type, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : 'button'
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
