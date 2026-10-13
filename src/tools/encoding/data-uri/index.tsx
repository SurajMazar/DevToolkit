import { useEffect, useMemo, useState } from 'react'
import { FileUp, ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Toolbar, ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { InputEditorPane, OutputEditorPane } from '@/components/tools/EditorPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { FileDropzone } from '@/components/common/FileDropzone'
import { CopyButton } from '@/components/common/CopyButton'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useDebouncedValue, adaptiveDelay } from '@/hooks/useDebounced'
import { buildDataUri, dataUriSizes, isImageMime, isTextMime, mimeFromName, type DataUriEncoding } from '@/engines/encoding/dataUri'
import { sniffMime } from '@/engines/encoding/base64'
import { pickFile } from '@/utils/files'
import { formatBytes, formatNumber } from '@/utils/format'
import { cn } from '@/utils/cn'
import { DecodeView } from './DecodeView'

const TEXT_MIMES = ['text/plain', 'text/html', 'text/css', 'image/svg+xml', 'application/json', 'text/csv', 'text/javascript', 'application/xml', 'text/markdown']
const TEXT_SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f766e"/><path d="M18 33l9 9 19-20" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`

interface FileSource {
  name: string
  size: number
  mime: string
  bytes: Uint8Array
}

export default function DataUriTool() {
  const [mode, setMode] = usePersistentState<'create' | 'decode'>('mode', 'create')
  const [source, setSource] = usePersistentState<'text' | 'file'>('source', 'text')
  const [text, setText] = usePersistentState('text', '')
  const [textMime, setTextMime] = usePersistentState('textMime', 'image/svg+xml')
  const [charset, setCharset] = usePersistentState<'utf-8' | 'none'>('charset', 'utf-8')
  const [encodingPref, setEncodingPref] = usePersistentState<DataUriEncoding | 'auto'>('encoding', 'auto')
  const [decodeInput, setDecodeInput] = usePersistentState('decodeInput', '')
  const [file, setFile] = useState<FileSource | null>(null)
  const [mimeOverride, setMimeOverride] = useState('')

  const debouncedText = useDebouncedValue(text, adaptiveDelay(text.length))
  const bytes = useMemo(() => (source === 'text' ? new TextEncoder().encode(debouncedText) : (file?.bytes ?? null)), [source, debouncedText, file])
  const mime = source === 'text' ? textMime : mimeOverride.trim() || file?.mime || 'application/octet-stream'
  const effCharset = source === 'text' ? (charset === 'utf-8' ? 'utf-8' : null) : isTextMime(mime) && charset === 'utf-8' ? 'utf-8' : null
  const sizes = useMemo(() => (bytes ? dataUriSizes(bytes, { mime, charset: effCharset }) : null), [bytes, mime, effCharset])
  const recommended: DataUriEncoding | null = sizes ? (sizes.percent < sizes.base64 ? 'percent' : 'base64') : null
  const encoding: DataUriEncoding = encodingPref === 'auto' ? (recommended ?? 'base64') : encodingPref
  const hasData = !!bytes && (source === 'file' || debouncedText.length > 0)
  const uri = useMemo(() => (bytes && hasData ? buildDataUri(bytes, { mime, encoding, charset: effCharset }) : ''), [bytes, hasData, mime, encoding, effCharset])

  const loadFile = async (f: File) => {
    try {
      const b = new Uint8Array(await f.arrayBuffer())
      setFile({ name: f.name, size: f.size, mime: f.type || mimeFromName(f.name) || sniffMime(b) || 'application/octet-stream', bytes: b })
      setMimeOverride('')
      setSource('file')
      setMode('create')
    } catch (e) {
      toast.error(`Could not read ${f.name}`, { description: String(e) })
    }
  }
  const chooseFile = async () => {
    const f = await pickFile()
    if (f) void loadFile(f)
  }

  const modeSwitch = (
    <Segmented
      aria-label="Direction"
      value={mode}
      onValueChange={setMode}
      options={[
        { value: 'create', label: 'Create' },
        { value: 'decode', label: 'Decode' },
      ]}
    />
  )

  if (mode === 'decode') return <DecodeView toolbar={<Toolbar>{modeSwitch}</Toolbar>} input={decodeInput} setInput={setDecodeInput} />

  const encodingLabel = (e: DataUriEncoding) => (
    <span className="flex items-center gap-1.5">
      {e === 'base64' ? 'Base64' : 'Percent'}
      {sizes && <span className="text-2xs font-normal text-subtle tabular">{formatBytes(sizes[e])}</span>}
    </span>
  )

  const toolbar = (
    <Toolbar>
      {modeSwitch}
      <ToolbarSeparator />
      <Segmented
        aria-label="Source"
        value={source}
        onValueChange={setSource}
        options={[
          { value: 'text', label: 'Text' },
          { value: 'file', label: 'File' },
        ]}
      />
      {source === 'text' ? (
        <ToolbarField label="Type">
          <Select aria-label="Media type" value={textMime} onValueChange={setTextMime} options={TEXT_MIMES.map((m) => ({ value: m, label: m }))} className="w-[150px]" />
        </ToolbarField>
      ) : (
        <>
          <Button size="sm" onClick={chooseFile}>
            <FileUp /> {file ? 'Another file' : 'Choose file'}
          </Button>
          {file && (
            <ToolbarField label="Type">
              <Input value={mimeOverride} onChange={(e) => setMimeOverride(e.target.value)} placeholder={file.mime} className="mono h-7 w-44 text-[12.5px]" aria-label="Media type override" />
            </ToolbarField>
          )}
        </>
      )}
      {(source === 'text' || isTextMime(mime)) && (
        <ToolbarField label="Charset">
          <Select
            aria-label="Charset parameter"
            value={charset}
            onValueChange={setCharset}
            options={[
              { value: 'utf-8', label: 'utf-8' },
              { value: 'none', label: 'omit' },
            ]}
          />
        </ToolbarField>
      )}
      <ToolbarSeparator />
      <Segmented
        aria-label="Data encoding"
        value={encoding}
        onValueChange={(v) => setEncodingPref(v)}
        options={[
          { value: 'base64', label: encodingLabel('base64') },
          { value: 'percent', label: encodingLabel('percent') },
        ]}
      />
      {encodingPref !== 'auto' && (
        <Button size="xs" variant="ghost" onClick={() => setEncodingPref('auto')}>
          Use smaller
        </Button>
      )}
    </Toolbar>
  )

  const inputPane =
    source === 'text' ? (
      <InputEditorPane title="Content" value={text} onChange={setText} sample={TEXT_SAMPLE} placeholder="Type or paste content — SVG, HTML, JSON, CSS…" wordWrap path="data-uri-text" language={textMime === 'image/svg+xml' || textMime === 'application/xml' ? 'xml' : textMime === 'application/json' ? 'json' : textMime === 'text/html' ? 'html' : textMime === 'text/css' ? 'css' : 'plaintext'} />
    ) : (
      <Pane aria-label="File">
        <PaneHeader title="File" />
        <FileDropzone onFile={loadFile} className="flex min-h-0 flex-1 flex-col">
          {file ? (
            <FilePreview file={file} mime={mime} />
          ) : (
            <EmptyState icon={<FileUp />} title="Drop a file to turn it into a data URI" description="Images, fonts, SVG, small documents — read locally, never uploaded." actions={<Button onClick={chooseFile}>Choose file</Button>} />
          )}
        </FileDropzone>
      </Pane>
    )

  const comparison = sizes && hasData && (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-1.5 text-2xs">
      {(['base64', 'percent'] as const).map((e) => (
        <span key={e} className={cn('flex items-center gap-1', encoding === e ? 'text-fg' : 'text-muted')}>
          {e === 'base64' ? 'Base64' : 'Percent-encoded'} <span className="tabular">{formatNumber(sizes[e])} chars</span>
          {recommended === e && <Badge tone="ok">smaller</Badge>}
        </span>
      ))}
      <span className="text-subtle">
        {(() => {
          const pct = Math.round((1 - Math.min(sizes.base64, sizes.percent) / Math.max(sizes.base64, sizes.percent)) * 100)
          if (pct < 3) return 'Both encodings are about the same size here'
          return recommended === 'percent' ? `Percent-encoding is ${pct}% shorter — typical for SVG and plain text` : `Base64 is ${pct}% shorter — typical for binary data`
        })()}
      </span>
    </div>
  )

  const outputPane = (
    <OutputEditorPane
      title="Data URI"
      value={uri}
      wordWrap
      filename="data-uri.txt"
      path="data-uri-output"
      meta={uri ? `${formatNumber(uri.length)} chars` : undefined}
      banner={comparison}
      actions={
        uri ? (
          <>
            <CopyButton value={() => `url("${uri}")`} label="CSS url()" showLabel size="xs" tooltip='Copy as CSS url("…")' />
            {isImageMime(mime) && <CopyButton value={() => `<img src="${uri}" alt="">`} label="<img>" showLabel size="xs" tooltip="Copy as an <img> tag" />}
          </>
        ) : null
      }
      emptyState={!hasData ? <EmptyState compact title={source === 'text' ? 'Type content to build a data URI.' : 'Choose a file to build a data URI.'} description="Both Base64 and percent-encoding are sized so you can pick the shorter one." /> : undefined}
    />
  )

  return (
    <>
      {toolbar}
      <SplitPane id="data-uri-create" initial={0.45} mobileTabs={[source === 'text' ? 'Content' : 'File', 'Data URI']}>
        {inputPane}
        {outputPane}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Data">{bytes && hasData ? formatBytes(bytes.length) : '—'}</StatusItem>
        <StatusItem label="URI">{uri ? formatBytes(uri.length) : '—'}</StatusItem>
        {uri && bytes && bytes.length > 0 && <StatusItem label="Overhead">+{Math.round((uri.length / bytes.length - 1) * 100)}%</StatusItem>}
        <StatusItem label="Type">{mime}</StatusItem>
        <StatusSpacer />
        {uri.length > 32 * 1024 && <StatusItem tone="mod">Large URIs bloat HTML/CSS and can’t be cached separately</StatusItem>}
      </StatusBar>
    </>
  )
}

function FilePreview({ file, mime }: { file: FileSource; mime: string }) {
  const url = useMemo(() => (isImageMime(mime) ? URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: mime })) : null), [file, mime])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      {url ? (
        <img src={url} alt={file.name} className="max-h-56 max-w-full rounded-md border border-border object-contain [background:repeating-conic-gradient(var(--surface)_0_25%,transparent_0_50%)_0_0/16px_16px]" />
      ) : (
        <div className="flex size-14 items-center justify-center rounded-lg border border-border bg-surface text-subtle">
          <ImageIcon className="size-6" />
        </div>
      )}
      <div>
        <p className="break-all text-sm font-medium text-fg">{file.name}</p>
        <p className="text-xs text-muted">
          {mime} · {formatBytes(file.size)}
        </p>
      </div>
    </div>
  )
}
