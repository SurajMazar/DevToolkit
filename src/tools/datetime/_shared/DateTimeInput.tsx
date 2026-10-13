import { forwardRef } from 'react'
import { inputClass } from '@/components/ui/input'
import { cn } from '@/utils/cn'

/**
 * Native date-time field with second precision. Value format: "YYYY-MM-DDTHH:mm:ss"
 * (a Temporal.PlainDateTime string). The native picker follows the theme's color-scheme.
 */
export const DateTimeInput = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void }>(
  ({ value, onChange, className, ...props }, ref) => (
    <input
      ref={ref}
      type="datetime-local"
      step={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputClass, 'mono tabular w-auto min-w-0 text-[13px]', className)}
      {...props}
    />
  ),
)
DateTimeInput.displayName = 'DateTimeInput'
