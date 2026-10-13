import { useEffect, useMemo, useState } from 'react'
import { Download, FileQuestion } from 'lucide-react'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { SplitPane } from '@/components/tools/SplitPane'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { KeyValueTable } from '@/components/tools/SettingsLayout'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { CodeEditor } from '@/components/editors/CodeEditor'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/common/CopyButton'
import { useDebouncedValue, adaptiveDelay } from '@/hooks/useDebounced'
import { extensionForMime, isImageMime, isTextMime, parseDataUri } from '@/engines/encoding/dataUri'
import { sniffMime } from '@/engines/encoding/base64'
import { downloadText } from '@/utils/download'
import { formatBytes, formatNumber } from '@/utils/format'

const SAMPLE =
  'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%230f766e%22%2F%3E%3Cpath%20d%3D%22M18%2033l9%209%2019-20%22%20fill%3D%22none%22%20stroke%3D%22%23fff%22%20stroke-width%3D%226%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E'

function decodeText(bytes: Uint8Array, charset: string | null): { text: string; note: string | null } {
  const label = charset && !/^us-ascii$/i.test(charset) ? charset : 'utf-8'
  try {
    return { text: new TextDecoder(label).decode(bytes), note: null }
  } catch {
    return { text: new TextDecoder().decode(bytes), note: `Unknown charset “${charset}” — shown as UTF-8` }
  }
}

export function DecodeView({ toolbar, input, setInput }: { toolbar: React.ReactNode; input: string; setInput: (v: string) => void }) {
  const debounced = useDebouncedValue(input, adaptiveDelay(input.length))
  const parsed = useMemo(() => (debounced.trim() ? parseDataUri(debounced) : null), [debounced])
  const value = parsed?.ok ? parsed.value : null
  const image = value && isImageMime(value.mime)
  const text = value && !image && isTextMime(value.mime)
  const decoded = useMemo(() => (value && text ? decodeText(value.bytes, value.charset) : null), [value, text])
  const sniffed = value ? sniffMime(value.bytes) : null
  const [imgError, setImgError] = useState(false)

  const blobUrl = useMemo(() => (value && image ? URL.createObjectURL(new Blob([value.bytes as BlobPart], { type: value.mime })) : null), [value, image])
  useEffect(() => {
    setImgError(false)
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  const download = () => value && downloadText(new Blob([value.bytes as BlobPart], { type: value.mime }), `decoded.${extensionForMime(value.mime)}`)

  const rows = value
    ? [
        { key: 'Media type', value: value.mime, hint: value.mimeExplicit ? undefined : 'default (none given)' },
        ...value.params.map((p) => ({ key: `;${p.name}`, value: p.value })),
        ...(value.params.some((p) => p.name === 'charset') || !value.charset ? [] : [{ key: 'Charset', value: value.charset, hint: 'implied' }]),
        { key: 'Encoding', value: value.base64 ? 'Base64' : 'Percent-encoded' },
        { key: 'Decoded size', value: `${formatBytes(value.bytes.length)} (${formatNumber(value.bytes.length)} bytes)` },
        { key: 'URI length', value: `${formatNumber(value.uriLength)} chars · ${value.bytes.length ? `${Math.round((value.uriLength / value.bytes.length) * 100)}% of the data` : '—'}` },
        ...(sniffed && sniffed !== value.mime ? [{ key: 'Content looks like', value: sniffed, tone: 'warn' as const }] : []),
      ]
    : []

  return (
    <>
      {toolbar}
      <SplitPane id="data-uri-decode" initial={0.42} mobileTabs={['Data URI', 'Result']}>
        <InputEditorPane title="Data URI" value={input} onChange={setInput} sample={SAMPLE} placeholder="Paste a data: URI — data:image/png;base64,iVBORw0…" wordWrap path="data-uri-input" />
        <Pane aria-label="Result">
          <PaneHeader
            title="Result"
            meta={value ? `${value.mime} · ${formatBytes(value.bytes.length)}` : undefined}
            actions={value ? <Button size="xs" variant="ghost" onClick={download}><Download /> Download</Button> : undefined}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!parsed && (
              <EmptyState
                title="Paste a data: URI to inspect it."
                description="The media type, parameters and size are shown; images are previewed safely with <img> (SVG scripts never run), text is shown as text."
              />
            )}
            {parsed && !parsed.ok && <ErrorDisplay error={parsed.error.message + (parsed.error.offset != null ? ` (at character ${parsed.error.offset + 1})` : '')} />}
            {value?.warnings.map((w) => <ErrorDisplay key={w} severity="warning" error={w} />)}
            {value && (
              <>
                <div className="p-4">
                  <KeyValueTable rows={rows} />
                </div>
                {image && blobUrl && (
                  <section aria-label="Preview" className="border-t border-border">
                    <h3 className="eyebrow flex h-8 items-center px-4">Preview</h3>
                    <div className="flex justify-center px-4 pb-4">
                      {imgError ? (
                        <p className="text-sm text-danger">The data does not decode as a valid {value.mime} image{sniffed ? ` (it looks like ${sniffed})` : ''}.</p>
                      ) : (
                        <img
                          src={blobUrl}
                          alt="Decoded data URI"
                          onError={() => setImgError(true)}
                          className="max-h-72 max-w-full rounded-md border border-border object-contain [background:repeating-conic-gradient(var(--surface)_0_25%,transparent_0_50%)_0_0/16px_16px]"
                        />
                      )}
                    </div>
                  </section>
                )}
                {decoded && (
                  <section aria-label="Decoded text" className="flex flex-col border-t border-border">
                    <div className="flex h-8 items-center gap-2 pl-4 pr-2">
                      <h3 className="eyebrow">Decoded text</h3>
                      {decoded.note && <span className="text-2xs text-warn">{decoded.note}</span>}
                      <CopyButton value={decoded.text} label="Copy decoded text" className="ml-auto" />
                    </div>
                    <div className="h-72 border-t border-border">
                      <CodeEditor value={decoded.text} readOnly ariaLabel="Decoded text (read-only)" language={languageFor(value.mime)} wordWrap path="data-uri-decoded" />
                    </div>
                  </section>
                )}
                {!image && !text && (
                  <div className="border-t border-border">
                    <EmptyState
                      compact
                      icon={<FileQuestion />}
                      title={`${value.mime} can’t be previewed here.`}
                      description="Download the decoded bytes to open them with an appropriate app."
                      actions={
                        <Button size="sm" onClick={download}>
                          <Download /> Download {formatBytes(value.bytes.length)}
                        </Button>
                      }
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </Pane>
      </SplitPane>
      <StatusBar>
        <StatusItem label="URI">{formatNumber(input.trim().length)} chars</StatusItem>
        {value && <StatusItem label="Decoded">{formatBytes(value.bytes.length)}</StatusItem>}
        {value && <StatusItem label="Type">{value.mime}</StatusItem>}
        {parsed && !parsed.ok && <StatusItem tone="danger">Malformed</StatusItem>}
        <StatusSpacer />
        <span className="text-subtle">Previewed locally · scripts never run</span>
      </StatusBar>
    </>
  )
}

function languageFor(mime: string): string {
  if (/json/.test(mime)) return 'json'
  if (/svg|xml/.test(mime)) return 'xml'
  if (/html/.test(mime)) return 'html'
  if (/css/.test(mime)) return 'css'
  if (/javascript|ecmascript/.test(mime)) return 'javascript'
  return 'plaintext'
}
