import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/utils/cn'
import { formatBytes } from '@/utils/format'

interface FileDropzoneProps {
  onFile: (file: File) => void
  className?: string
  children: React.ReactNode
  label?: string
  disabled?: boolean
  /** Reject files larger than this (bytes). Defaults to 512 MB — the practical browser limit. */
  maxBytes?: number
}

/** Wraps a region so files can be dropped onto it. Shows an overlay while dragging. */
export function FileDropzone({ onFile, className, children, label = 'Drop file to load', disabled, maxBytes = 512 * 1024 * 1024 }: FileDropzoneProps) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  return (
    <div
      className={cn('relative', className)}
      onDragEnter={(e) => {
        if (disabled || !hasFiles(e)) return
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => {
        if (disabled || !hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        if (disabled) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      }}
      onDrop={(e) => {
        if (disabled || !hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        depth.current = 0
        setOver(false)
        const file = e.dataTransfer.files?.[0]
        if (!file) return
        if (file.size > maxBytes) {
          toast.error(`${file.name} is ${formatBytes(file.size)} — larger than the ${formatBytes(maxBytes)} limit for this tool`)
          return
        }
        onFile(file)
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent-soft backdrop-blur-[1px] animate-fade-in">
          <div className="flex items-center gap-2 rounded-md bg-raised px-3 py-1.5 text-sm font-medium text-fg shadow-pop">
            <FileUp className="size-4 text-accent-text" />
            {label}
          </div>
        </div>
      )}
    </div>
  )
}
