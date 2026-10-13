import { ChevronDown, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { downloadText } from '@/utils/download'

export interface DownloadOption {
  label: string
  filename: string
  mime: string
  getContent: () => string
}

/** "Download ▾" menu offering several file formats of the same result. */
export function DownloadMenu({ options, disabled }: { options: DownloadOption[]; disabled?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled}>
          <Download /> Download <ChevronDown className="-mr-1 text-subtle" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {options.map((o) => (
          <DropdownMenuItem key={o.filename} onSelect={() => downloadText(o.getContent(), o.filename, o.mime)}>
            <Download />
            <span className="flex-1">{o.label}</span>
            <span className="mono text-2xs text-subtle">{o.filename.slice(o.filename.lastIndexOf('.'))}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
