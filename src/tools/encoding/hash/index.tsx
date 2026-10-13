import { useEffect, useMemo, useState } from 'react'
import { CircleCheck, CircleX, FileUp, Info, Loader2, ShieldAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { FileDropzone } from '@/components/common/FileDropzone'
import { CopyButton } from '@/components/common/CopyButton'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useTask } from '@/hooks/useTask'
import { useWorker } from '@/hooks/useWorker'
import {
  HASH_ALGOS,
  MAX_FILE_BYTES,
  encodeDigest,
  guessDigestShape,
  hashAll,
  matchExpected,
  parseKey,
  subtleAvailable,
  type DigestEncoding,
  type HashAlgo,
  type HashResult,
  type KeyEncoding,
} from '@/engines/encoding/hash'
import { pickFile } from '@/utils/files'
import { formatBytes, formatDuration, utf8Length } from '@/utils/format'
import { cn } from '@/utils/cn'
import HashWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const SAMPLE = 'The quick brown fox jumps over the lazy dog'

interface FileInput {
  name: string
  size: number
  bytes: Uint8Array
}

export default function HashGenerator() {
  // Plain state on purpose: inputs and keys of this sensitive tool are never persisted.
  const [source, setSource] = useState<'text' | 'file'>('text')
  const [mode, setMode] = useState<'hash' | 'hmac'>('hash')
  const [encoding, setEncoding] = useState<DigestEncoding>('hex')
  const [text, setText] = useState('')
  const [file, setFile] = useState<FileInput | null>(null)
  const [key, setKey] = useState('')
  const [keyEncoding, setKeyEncoding] = useState<KeyEncoding>('text')
  const [expected, setExpected] = useState('')
  useIncomingInput(setText)

  const secure = subtleAvailable()
  const algos: HashAlgo[] = useMemo(() => (secure ? HASH_ALGOS.map((a) => a.id) : ['MD5']), [secure])
  const debouncedText = useDebouncedValue(text, adaptiveDelay(text.length))
  const debouncedKey = useDebouncedValue(key, 150)
  const worker = useWorker<Tasks>(() => new HashWorker())
  const task = useTask<HashResult[]>()

  const keyParse = useMemo(() => {
    if (mode !== 'hmac') return { key: null as Uint8Array | null, error: null as string | null }
    if (!debouncedKey) return { key: null, error: null }
    try {
      return { key: parseKey(debouncedKey, keyEncoding), error: null }
    } catch (e) {
      return { key: null, error: (e as Error).message }
    }
  }, [mode, debouncedKey, keyEncoding])

  const hmacWaiting = mode === 'hmac' && !keyParse.key
  const hasInput = source === 'text' ? true : !!file

  useEffect(() => {
    if (hmacWaiting || !hasInput) {
      task.reset()
      return
    }
    if (source === 'text') {
      const bytes = new TextEncoder().encode(debouncedText)
      void task.run(() => hashAll(bytes, algos, keyParse.key))
    } else if (file) {
      void task.run((signal) => worker.run('hash', { bytes: file.bytes, algos, key: keyParse.key }, signal))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, debouncedText, file, keyParse, hmacWaiting, algos, mode])

  const results = task.result ?? null
  const matches = useMemo(() => (results && expected.trim() ? matchExpected(expected, results) : []), [results, expected])

  const loadFile = async (f: File) => {
    if (f.size > MAX_FILE_BYTES) {
      toast.error(`${f.name} is ${formatBytes(f.size)} — Web Crypto hashes a file in one piece, so the limit here is ${formatBytes(MAX_FILE_BYTES)}`)
      return
    }
    try {
      setFile({ name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) })
      setSource('file')
    } catch (e) {
      toast.error(`Could not read ${f.name}`, { description: String(e) })
    }
  }
  const chooseFile = async () => {
    const f = await pickFile()
    if (f) void loadFile(f)
  }

  const label = mode === 'hmac' ? 'HMAC' : 'Hash'
  const toolbar = (
    <Toolbar>
      <Segmented
        aria-label="Input source"
        value={source}
        onValueChange={setSource}
        options={[
          { value: 'text', label: 'Text' },
          { value: 'file', label: 'File' },
        ]}
      />
      <Segmented
        aria-label="Mode"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: 'hash', label: 'Digest' },
          { value: 'hmac', label: 'HMAC' },
        ]}
      />
      <ToolbarSeparator />
      <ToolbarField label="Output">
        <Select
          aria-label="Output encoding"
          value={encoding}
          onValueChange={setEncoding}
          options={[
            { value: 'hex', label: 'hex' },
            { value: 'HEX', label: 'HEX' },
            { value: 'base64', label: 'Base64' },
            { value: 'base64url', label: 'Base64url' },
          ]}
        />
      </ToolbarField>
      {source === 'file' && (
        <>
          <ToolbarSeparator />
          <Button size="sm" onClick={chooseFile}>
            <FileUp /> {file ? 'Choose another file' : 'Choose file'}
          </Button>
        </>
      )}
      <ToolbarSpacer />
      <span className="flex shrink-0 items-center gap-1 text-2xs text-subtle">
        <Info className="size-3" /> One-way: a hash can’t be decrypted
      </span>
    </Toolbar>
  )

  const inputPane =
    source === 'text' ? (
      <InputEditorPane title="Text" value={text} onChange={setText} sample={SAMPLE} placeholder="Type or paste text — hashed as UTF-8 bytes, exactly as typed (including trailing newlines)…" path="hash-input" wordWrap />
    ) : (
      <Pane aria-label="File">
        <PaneHeader title="File" actions={file ? <Button size="xs" variant="ghost" onClick={() => setFile(null)}><X /> Remove</Button> : undefined} />
        <FileDropzone onFile={loadFile} maxBytes={MAX_FILE_BYTES} className="flex min-h-0 flex-1 flex-col">
          {file ? (
            <div className="flex flex-1 flex-col gap-1 px-4 py-4">
              <p className="break-all text-sm font-medium text-fg">{file.name}</p>
              <p className="text-xs text-muted">{formatBytes(file.size)} · read locally, never uploaded</p>
              <p className="mt-3 text-2xs leading-4 text-subtle">
                Web Crypto has no streaming digest API, so the whole file is held in memory while hashing (up to {formatBytes(MAX_FILE_BYTES)}). Drop another file to replace it.
              </p>
            </div>
          ) : (
            <EmptyState
              icon={<FileUp />}
              title="Drop a file to hash it"
              description={`Any file up to ${formatBytes(MAX_FILE_BYTES)}. It is hashed in a background worker, locally.`}
              actions={<Button onClick={chooseFile}>Choose file</Button>}
            />
          )}
        </FileDropzone>
      </Pane>
    )

  const resultsPane = (
    <Pane aria-label="Digests">
      <PaneHeader
        title={mode === 'hmac' ? 'HMACs' : 'Digests'}
        meta={
          <span className="flex items-center gap-1.5">
            {task.running && <Loader2 className="size-3 animate-spin" aria-label="Hashing" />}
            {source === 'text' ? `${formatBytes(utf8Length(debouncedText))} of UTF-8` : file ? formatBytes(file.size) : ''}
          </span>
        }
        actions={task.running && source === 'file' ? <Button size="xs" variant="ghost" onClick={task.cancel}>Cancel</Button> : undefined}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!secure && (
          <ErrorDisplay
            severity="warning"
            error="Web Crypto (crypto.subtle) is unavailable because this page isn’t a secure context (HTTPS or localhost). SHA digests and HMACs need it — only MD5 is shown."
          />
        )}
        {mode === 'hmac' && (
          <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <label htmlFor="hmac-key" className="text-xs font-medium text-muted">
                Secret key
              </label>
              <Segmented
                size="xs"
                className="ml-auto"
                aria-label="Key encoding"
                value={keyEncoding}
                onValueChange={setKeyEncoding}
                options={[
                  { value: 'text', label: 'Text' },
                  { value: 'hex', label: 'Hex' },
                  { value: 'base64', label: 'Base64' },
                ]}
              />
            </div>
            <Input
              id="hmac-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              className="mono text-[12.5px]"
              aria-invalid={!!keyParse.error}
              placeholder={keyEncoding === 'hex' ? 'e.g. 0b0b0b0b…' : keyEncoding === 'base64' ? 'Base64 or base64url key' : 'Shared secret (UTF-8)'}
            />
            {keyParse.error ? <p className="text-xs text-danger">{keyParse.error}</p> : <p className="text-2xs text-subtle">Keyed hash (RFC 2104) — proves the message came from someone holding the key. Never stored.</p>}
          </div>
        )}
        {task.error && <ErrorDisplay error={task.error.message} />}
        {hmacWaiting ? (
          <EmptyState compact title="Enter a secret key to compute HMACs." description="HMAC-SHA-256 is what most webhook signatures (Stripe, GitHub, Slack) use." />
        ) : !hasInput ? (
          <EmptyState compact title="Choose a file to see its digests." />
        ) : (
          <ul aria-label={`${label} results`}>
            {algos.map((id) => {
              const info = HASH_ALGOS.find((a) => a.id === id)!
              const r = results?.find((x) => x.algo === id)
              const value = r ? encodeDigest(r.bytes, encoding) : ''
              const match = matches.find((m) => m.algo === id)
              return (
                <li key={id} className={cn('group border-b border-border px-4 py-2.5', match && 'bg-ok-soft')}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg">
                      {mode === 'hmac' ? 'HMAC-' : ''}
                      {id}
                    </span>
                    <span className="text-2xs text-subtle tabular">{info.bits} bits</span>
                    {info.status === 'broken' && <Badge tone="danger" title={info.note}>Legacy checksum · not secure</Badge>}
                    {info.status === 'legacy' && <Badge tone="warn" title={info.note}>Legacy · insecure for signatures</Badge>}
                    {match && (
                      <Badge tone="ok">
                        <CircleCheck className="size-3" /> Matches ({match.encoding})
                      </Badge>
                    )}
                    <CopyButton value={value} label={`Copy ${id}`} disabled={!value} className="ml-auto" />
                  </div>
                  <p className={cn('mono mt-0.5 break-all text-[12.5px] leading-5', value ? 'text-fg' : 'text-subtle')}>{value || '…'}</p>
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex flex-col gap-1.5 px-4 py-3">
          <label htmlFor="hash-expected" className="text-xs font-medium text-muted">
            Verify against an expected {mode === 'hmac' ? 'HMAC' : 'hash'}
          </label>
          <Input id="hash-expected" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Paste a hex or Base64 digest (sha256sum output works too)" className="mono text-[12.5px]" autoComplete="off" />
          {expected.trim() && results && <VerifyLine matches={matches.map((m) => `${mode === 'hmac' ? 'HMAC-' : ''}${m.algo} (${m.encoding})`)} shape={guessDigestShape(expected)} />}
        </div>
        <div className="mx-4 mb-4 flex gap-2.5 rounded-md border border-border bg-surface/60 px-3 py-2.5 text-xs leading-5 text-muted">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-subtle" />
          <p>
            Hashing is <span className="text-fg">one-way</span>, not encryption: there is no key and no way to “decrypt” a digest back into the input. Matching a known hash only
            works by hashing a candidate input and comparing. For passwords use a slow, salted KDF (Argon2, bcrypt, scrypt) — never a bare SHA or MD5.
          </p>
        </div>
      </div>
    </Pane>
  )

  return (
    <>
      {toolbar}
      <SplitPane id="hash" initial={0.45} mobileTabs={[source === 'text' ? 'Text' : 'File', mode === 'hmac' ? 'HMACs' : 'Digests']}>
        {inputPane}
        {resultsPane}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Input">{source === 'text' ? formatBytes(utf8Length(debouncedText)) : file ? formatBytes(file.size) : '—'}</StatusItem>
        <StatusItem label="Mode">{mode === 'hmac' ? 'HMAC' : 'Digest'}</StatusItem>
        <StatusItem label="Output">{encoding}</StatusItem>
        {expected.trim() && results && <StatusItem tone={matches.length ? 'ok' : 'danger'}>{matches.length ? 'Match' : 'No match'}</StatusItem>}
        <StatusSpacer />
        {task.duration != null && results && <StatusItem label="Took">{formatDuration(task.duration)}</StatusItem>}
        <span className="text-subtle">Never stored</span>
      </StatusBar>
    </>
  )
}

function VerifyLine({ matches, shape }: { matches: string[]; shape: string | null }) {
  if (matches.length)
    return (
      <p className="flex items-center gap-1.5 text-xs text-ok">
        <CircleCheck className="size-3.5" /> Matches {matches.join(', ')}
      </p>
    )
  return (
    <p className="flex items-start gap-1.5 text-xs text-danger">
      <CircleX className="mt-px size-3.5 shrink-0" />
      <span>
        No algorithm matches{shape ? ` — it looks like ${shape}, so the input differs (check for a trailing newline, encoding or whitespace)` : ' — it doesn’t have the length of any supported digest'}.
      </span>
    </p>
  )
}
