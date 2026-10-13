import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { copyText } from '@/utils/clipboard'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/utils/cn'

interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children' | 'value'> {
  /** Text or a function producing it lazily (avoids holding large strings). */
  value: string | (() => string | Promise<string>)
  label?: string
  /** Show text next to the icon. */
  showLabel?: boolean
  tooltip?: string
  shortcut?: string[]
}

export function CopyButton({ value, label = 'Copy', showLabel, tooltip, shortcut, variant = 'ghost', size, className, disabled, ...rest }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const onClick = async () => {
    const text = typeof value === 'function' ? await value() : value
    const ok = await copyText(text)
    if (!ok) {
      toast.error('Clipboard access was blocked by the browser')
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1400)
  }

  const icon = copied ? <Check className="text-ok" /> : <Copy />
  const btn = (
    <Button
      variant={variant}
      size={size ?? (showLabel ? 'sm' : 'icon-sm')}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(className)}
      {...rest}
    >
      {icon}
      {showLabel && <span>{copied ? 'Copied' : label}</span>}
    </Button>
  )
  if (showLabel && !tooltip) return btn
  return (
    <Tooltip content={copied ? 'Copied' : (tooltip ?? label)} shortcut={shortcut}>
      {btn}
    </Tooltip>
  )
}
