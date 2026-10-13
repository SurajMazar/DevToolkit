import { Download } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { downloadText } from '@/utils/download'

interface DownloadButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  getContent: () => string | Blob
  filename: string | (() => string)
  mime?: string
  label?: string
  showLabel?: boolean
}

export function DownloadButton({ getContent, filename, mime, label = 'Download', showLabel, variant = 'ghost', size, ...rest }: DownloadButtonProps) {
  const onClick = () => downloadText(getContent(), typeof filename === 'function' ? filename() : filename, mime)
  const btn = (
    <Button variant={variant} size={size ?? (showLabel ? 'sm' : 'icon-sm')} onClick={onClick} aria-label={label} {...rest}>
      <Download />
      {showLabel && <span>{label}</span>}
    </Button>
  )
  return showLabel ? btn : <Tooltip content={label}>{btn}</Tooltip>
}
