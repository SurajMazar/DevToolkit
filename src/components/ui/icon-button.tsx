import * as React from 'react'
import { Button, type ButtonProps } from './button'
import { Tooltip } from './tooltip'

interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  label: string
  shortcut?: string[]
  icon: React.ReactNode
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

/** Icon-only button. Always carries an accessible label, surfaced as a tooltip. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, shortcut, icon, tooltipSide, variant = 'ghost', size = 'icon-sm', ...props }, ref) => (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <Button ref={ref} variant={variant} size={size} aria-label={label} {...props}>
        {icon}
      </Button>
    </Tooltip>
  ),
)
IconButton.displayName = 'IconButton'
