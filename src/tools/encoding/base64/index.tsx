import { useMemo, useState } from 'react'
import { Download, FileUp, ImageIcon } from 'lucide-react'
import { ConverterTool, type ConverterResult } from '@/components/tools/ConverterTool'
import { Toolbar, ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { Segmented } from '@/components/ui/segmented'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { OutputEditorPane } from '@/components/tools/EditorPane'
import { FileDropzone } from '@/components/common/FileDropzone'
import { EmptyState } from '@/components/tools/EmptyState'
import { StatusBar, StatusItem } from '@/components/tools/StatusBar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader, PaneBody } from '@/components/tools/Pane'
import { usePersistentState } from '@/hooks/usePersistentState'
import { base64ToBytes, bytesToBase64, decodeBase64, encodeBase64, sniffMime } from '@/engines/encoding/base64'
import { downloadText } from '@/utils/download'
import { pickFile } from '@/utils/files'
import { formatBytes } from '@/utils/format'

type View = 'text' | 'file'

function ViewSwitch({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <Segmented
      aria-label="Source"
      value={view}
      onValueChange={setView}
      options={[
        { value: 'text', label: 'Text' },
        { value: 'file', label: 'File' },
      ]}
    />
  )
}

function FileEncoder({ view, setView, urlSafe }: { view: View; setView: (v: View) => void; urlSafe: boolean }) {
  const [file, setFile] = useState<{ name: string; size: number; type: string; base64: string } | null>(null)
  const [asDataUri, setAsDataUri] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async (f: File) => {
    try {
      setError(null)
      const bytes = new Uint8Array(await f.arrayBuffer())
      setFile({ name: f.name, size: f.size, type: f.type || sniffMime(bytes) || 'application/octet-stream', base64: bytesToBase64(bytes, { urlSafe }) })
    } catch (e) {
      setError(`Could not read ${f.name}: ${String(e)}`)
    }
  }

  const output = file ? (asDataUri ? `data:${file.type};base64,${file.base64}` : file.base64) : ''
  const isImage = file?.type.startsWith('image/') && file.type !== 'image/svg+xml'

  return (
    <>
      <Toolbar>
        <ViewSwitch view={view} setView={setView} />
        <ToolbarSeparator />
        <Button size="sm" onClick={async () => { const f = await pickFile(); if (f) void load(f) }}>
          <FileUp /> Choose file
        </Button>
        <Checkbox checked={asDataUri} onCheckedChange={(v) => setAsDataUri(v === true)} label="Output as data URI" />
      </Toolbar>
      <SplitPane id="base64-file" initial={0.38} mobileTabs={['File', 'Base64']}>
        <Pane>
          <PaneHeader title="File" />
          <FileDropzone onFile={load} className="flex min-h-0 flex-1 flex-col">
            <PaneBody className="flex flex-col">
              {file ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
                  {isImage ? (
                    <img src={`data:${file.type};base64,${file.base64}`} alt={file.name} className="max-h-56 max-w-full rounded-md border border-border object-contain [background:repeating-conic-gradient(var(--surface)_0_25%,transparent_0_50%)_0_0/16px_16px]" />
                  ) : (
                    <div className="flex size-14 items-center justify-center rounded-lg border border-border bg-surface text-subtle"><ImageIcon className="size-6" /></div>
                  )}
                  <div>
                    <p className="text-sm font-medium break-all">{file.name}</p>
                    <p className="text-xs text-muted">{file.type} · {formatBytes(file.size)} → {formatBytes(file.base64.length)} Base64 (+{Math.round((file.base64.length / Math.max(1, file.size) - 1) * 100)}%)</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={async () => { const f = await pickFile(); if (f) void load(f) }}>Choose another file</Button>
                </div>
              ) : (
                <EmptyState
                  icon={<FileUp />}
                  title="Drop a file to encode it as Base64"
                  description="Images, PDFs, fonts — any file. It is read locally and never uploaded."
                  actions={<Button onClick={async () => { const f = await pickFile(); if (f) void load(f) }}>Choose file</Button>}
                />
              )}
              {error && <p className="px-4 pb-4 text-sm text-danger">{error}</p>}
            </PaneBody>
          </FileDropzone>
        </Pane>
        <OutputEditorPane title="Base64" value={output} wordWrap filename={`${file?.name ?? 'file'}.b64.txt`} />
      </SplitPane>
      <StatusBar>
        <StatusItem label="File">{file ? formatBytes(file.size) : '—'}</StatusItem>
        <StatusItem label="Base64">{file ? formatBytes(output.length) : '—'}</StatusItem>
      </StatusBar>
    </>
  )
}

export default function Base64Tool() {
  const [view, setView] = usePersistentState<View>('view', 'text')
  const [urlSafe, setUrlSafe] = usePersistentState('urlSafe', false)
  const [noPadding, setNoPadding] = usePersistentState('noPadding', false)
  const [wrap, setWrap] = usePersistentState<'0' | '76' | '64'>('wrap', '0')
  const [mode, setMode] = useState('encode')

  const options = useMemo(() => ({ urlSafe, noPadding, wrap }), [urlSafe, noPadding, wrap])

  if (view === 'file') return <FileEncoder view={view} setView={setView} urlSafe={urlSafe} />

  return (
    <ConverterTool
      onModeChange={setMode}
      modes={[
        { value: 'encode', label: 'Encode', inputLabel: 'Text', outputLabel: 'Base64', placeholder: 'Type or paste text to encode…', sample: 'Hello, World! ✓ Unicode is safe: café, 東京, 👩‍💻', outputExt: 'txt', inverse: 'decode' },
        { value: 'decode', label: 'Decode', inputLabel: 'Base64', outputLabel: 'Text', placeholder: 'Paste Base64 (standard or URL-safe; whitespace and missing padding are fine)…', sample: 'SGVsbG8sIFdvcmxkISDinJMgVW5pY29kZSBpcyBzYWZlOiBjYWbDqSwg5p2x5LqsLCDwn5Gp4oCN8J+Su', outputExt: 'txt', inverse: 'encode' },
      ]}
      optionsKey={options}
      outputWordWrap
      inputWordWrap
      options={
        <>
          <ViewSwitch view={view} setView={setView} />
          <ToolbarSeparator />
          {mode === 'encode' ? (
            <>
              <Checkbox checked={urlSafe} onCheckedChange={(v) => setUrlSafe(v === true)} label="URL-safe (- _)" />
              <Checkbox checked={noPadding} onCheckedChange={(v) => setNoPadding(v === true)} label="No padding" />
              <ToolbarField label="Wrap">
                <Select aria-label="Line wrapping" value={wrap} onValueChange={setWrap} options={[{ value: '0', label: 'None' }, { value: '76', label: '76 (MIME)' }, { value: '64', label: '64 (PEM)' }]} />
              </ToolbarField>
            </>
          ) : (
            <span className="text-xs text-subtle">Accepts standard and URL-safe alphabets</span>
          )}
        </>
      }
      transform={(input, m): ConverterResult => {
        if (m === 'encode') return { output: encodeBase64(input, { urlSafe, noPadding, lineLength: Number(wrap) }) }
        try {
          const d = decodeBase64(input)
          if (!d.isUtf8) {
            const mime = sniffMime(d.bytes)
            return {
              output: d.text,
              warning: `The decoded ${formatBytes(d.bytes.length)} are not valid UTF-8${mime ? ` — they look like ${mime}` : ''}. Use “Download bytes” to save the original binary.`,
            }
          }
          return { output: d.text, meta: `${formatBytes(d.bytes.length)} decoded` }
        } catch (e) {
          return { output: '', error: (e as Error).message }
        }
      }}
      outputActions={(output, input, result) =>
        mode === 'decode' && output && !result.error ? (
          <IconButton label="Download decoded bytes (binary-safe)" icon={<Download />} onClick={() => downloadDecodedBytes(input)} />
        ) : null
      }
    />
  )
}

function downloadDecodedBytes(b64: string) {
  const bytes = base64ToBytes(b64)
  const mime = sniffMime(bytes) ?? 'application/octet-stream'
  downloadText(new Blob([bytes as BlobPart], { type: mime }), `decoded.${mime.split('/')[1]?.replace('+xml', '') ?? 'bin'}`)
}
