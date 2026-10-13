import * as React from 'react'
import { cn } from '@/utils/cn'

export const inputClass =
  'h-8 w-full min-w-0 rounded-md border border-border bg-workspace px-2.5 text-sm text-fg placeholder:text-subtle transition-[border-color,box-shadow] duration-120 hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger-soft'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input ref={ref} type={type} spellCheck={false} className={cn(inputClass, className)} {...props} />
  ),
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      spellCheck={false}
      className={cn(inputClass, 'h-auto min-h-16 resize-y px-2.5 py-1.5 leading-5', className)}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
