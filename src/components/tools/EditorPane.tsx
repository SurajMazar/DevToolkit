import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ClipboardPaste, Download, Eraser, FileUp, Maximize2, Minimize2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { CodeEditor, type CodeEditorHandle, type CodeEditorProps, type EditorMarker } from '@/components/editors/CodeEditor'
import { Pane, PaneBody, PaneFooter, PaneHeader } from './Pane'
import { IconButton } from '@/components/ui/icon-button'
import { CopyButton } from '@/components/common/CopyButton'
import { downloadText } from '@/utils/download'
import { FileDropzone } from '@/components/common/FileDropzone'
import { readClipboardText } from '@/utils/clipboard'
import { pickFile, readFileAsText } from '@/utils/files'
import { countLines, formatBytes, pluralize, utf8Length } from '@/utils/format'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { modKey } from '@/utils/platform'
import { cn } from '@/utils/cn'

export function useTextMetrics(value: string) {
  const debounced = useDebouncedValue(value, adaptiveDelay(value.length))
  return useMemo(
    () => ({ chars: debounced.length, lines: countLines(debounced), bytes: utf8Length(debounced) }),
    [debounced],
  )
}

export function TextMetrics({ value, className }: { value: string; className?: string }) {
  const m = useTextMetrics(value)
  return (
    <span className={cn('flex items-center gap-3', className)}>
      <span>{pluralize(m.chars, 'char')}</span>
      <span>{pluralize(m.lines, 'line')}</span>
      <span>{formatBytes(m.bytes)}</span>
    </span>
  )
}

function useFullscreen() {
  const [full, setFull] = useState(false)
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])
  return [full, setFull] as const
}

export interface InputEditorPaneProps extends Omit<CodeEditorProps, 'ariaLabel' | 'onChange'> {
  title?: string
  onChange: (v: string) => void
  sample?: string | (() => string)
  sampleLabel?: string
  accept?: string
  onFileLoaded?: (name: string) => void
  markers?: EditorMarker[]
  actions?: React.ReactNode
  headerExtra?: React.ReactNode
  footer?: React.ReactNode | false
  className?: string
  /** Content rendered over an empty editor (purpose-written empty state). */
  emptyState?: React.ReactNode
  ariaLabel?: string
}

/** Standard input pane: Paste / Upload / Sample / Clear, drag-and-drop, metrics footer. */
export const InputEditorPane = forwardRef<CodeEditorHandle, InputEditorPaneProps>(function InputEditorPane(
  { title = 'Input', onChange, sample, sampleLabel = 'Load sample', accept, onFileLoaded, actions, headerExtra, footer, className, emptyState, ariaLabel, value, ...editorProps },
  ref,
) {
  const editor = useRef<CodeEditorHandle>(null)
  useImperativeHandle(ref, () => editor.current as CodeEditorHandle, [])
  const [full, setFull] = useFullscreen()

  const setUndoable = useCallback(
    (text: string) => {
      if (editor.current?.editor) editor.current.replaceAll(text)
      else onChange(text)
    },
    [onChange],
  )

  const loadFile = useCallback(
    async (file: File) => {
      try {
        const f = await readFileAsText(file)
        setUndoable(f.text)
        onFileLoaded?.(f.name)
        toast.success(`Loaded ${f.name}`, { description: formatBytes(f.size) })
      } catch (e) {
        toast.error(`Could not read ${file.name}`, { description: String(e) })
      }
    },
    [setUndoable, onFileLoaded],
  )

  const onPaste = async () => {
    const text = await readClipboardText()
    if (text == null) {
      toast.message(`Clipboard read was blocked — click into the editor and press ${modKey}+V`)
      editor.current?.focus()
      return
    }
    setUndoable(text)
  }

  const onUpload = async () => {
    const file = await pickFile(accept)
    if (file) void loadFile(file)
  }

  return (
    <Pane className={cn(full && 'fixed inset-0 z-40', className)} aria-label={title}>
      <PaneHeader
        title={title}
        actions={
          <>
            {actions}
            <IconButton label="Paste from clipboard" icon={<ClipboardPaste />} onClick={onPaste} />
            <IconButton label="Open file" icon={<FileUp />} onClick={onUpload} />
            {sample && (
              <IconButton label={sampleLabel} icon={<Sparkles />} onClick={() => setUndoable(typeof sample === 'function' ? sample() : sample)} />
            )}
            <IconButton label="Clear" icon={<Eraser />} onClick={() => setUndoable('')} disabled={!value} />
            <IconButton label={full ? 'Exit full screen' : 'Full screen'} shortcut={full ? ['Esc'] : undefined} icon={full ? <Minimize2 /> : <Maximize2 />} onClick={() => setFull(!full)} />
          </>
        }
      >
        {headerExtra}
      </PaneHeader>
      <FileDropzone onFile={loadFile} className="flex min-h-0 flex-1 flex-col">
        <PaneBody>
          <CodeEditor ref={editor} value={value} onChange={onChange} ariaLabel={ariaLabel ?? `${title} editor`} {...editorProps} />
          {!value && emptyState && <div className="pointer-events-none absolute inset-x-0 bottom-0 top-12 [&_button]:pointer-events-auto">{emptyState}</div>}
        </PaneBody>
      </FileDropzone>
      {footer !== false && <PaneFooter>{footer ?? <TextMetrics value={value} />}</PaneFooter>}
    </Pane>
  )
})

export interface OutputEditorPaneProps extends Omit<CodeEditorProps, 'ariaLabel' | 'readOnly'> {
  title?: string
  filename?: string | (() => string)
  mime?: string
  actions?: React.ReactNode
  headerExtra?: React.ReactNode
  meta?: React.ReactNode
  footer?: React.ReactNode | false
  className?: string
  emptyState?: React.ReactNode
  /** Rendered above the editor (e.g. ErrorDisplay). */
  banner?: React.ReactNode
  editable?: boolean
  ariaLabel?: string
  /** When the editor shows a preview, supply the full content for Copy/Download. */
  getFullContent?: () => string | Promise<string>
}

/** Standard output pane: Copy / Download / Full screen + metrics footer. */
export const OutputEditorPane = forwardRef<CodeEditorHandle, OutputEditorPaneProps>(function OutputEditorPane(
  { title = 'Output', filename = 'output.txt', mime, actions, headerExtra, meta, footer, className, emptyState, banner, editable, ariaLabel, getFullContent, value, ...editorProps },
  ref,
) {
  const [full, setFull] = useFullscreen()
  return (
    <Pane className={cn(full && 'fixed inset-0 z-40', className)} aria-label={title}>
      <PaneHeader
        title={title}
        meta={meta}
        actions={
          <>
            {actions}
            <CopyButton value={() => (getFullContent ? getFullContent() : value)} label="Copy output" disabled={!value} />
            <IconButton
              label="Download output"
              icon={<Download />}
              disabled={!value}
              onClick={async () => downloadText(getFullContent ? await getFullContent() : value, typeof filename === 'function' ? filename() : filename, mime)}
            />
            <IconButton label={full ? 'Exit full screen' : 'Full screen'} shortcut={full ? ['Esc'] : undefined} icon={full ? <Minimize2 /> : <Maximize2 />} onClick={() => setFull(!full)} />
          </>
        }
      >
        {headerExtra}
      </PaneHeader>
      {banner}
      <PaneBody>
        <CodeEditor ref={ref} value={value} readOnly={!editable} ariaLabel={ariaLabel ?? `${title} (read-only)`} {...editorProps} />
        {!value && emptyState && <div className="pointer-events-none absolute inset-0 bg-workspace [&_button]:pointer-events-auto">{emptyState}</div>}
      </PaneBody>
      {footer !== false && <PaneFooter>{footer ?? <TextMetrics value={value} />}</PaneFooter>}
    </Pane>
  )
})
