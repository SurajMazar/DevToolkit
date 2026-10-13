import { useEffect, useMemo, useRef, useState } from 'react'
import { FileUp, FlaskConical, ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { FileDropzone } from '@/components/common/FileDropzone'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useDebouncedValue, adaptiveDelay } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { analyzeUtf8, describeUtf8Problem, sequenceContaining, type Utf8Stats } from '@/engines/encoding/utf8'
import { generalCategory, CATEGORY_NAMES } from '@/engines/encoding/unicode'
import { sniffMime } from '@/engines/encoding/base64'
import { pickFile } from '@/utils/files'
import { formatBytes, formatDuration, formatNumber, pluralize } from '@/utils/format'
import { cn } from '@/utils/cn'
import { HexDump, type ByteRange, type HexDumpHandle } from './HexDump'
import { CharTable } from './CharTable'
import UtfWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const TEXT_SAMPLE = '﻿naïve café — 5 €\nΣίσυφος · 東京 · 🚀\nZWJ: 👩🏽‍💻  combining: é'
const MAX_FILE = 512 * 1024 * 1024
const BOM_LABEL = { 'utf-8': 'UTF-8 BOM', 'utf-16le': 'UTF-16 LE BOM', 'utf-16be': 'UTF-16 BE BOM', 'utf-32le': 'UTF-32 LE BOM', 'utf-32be': 'UTF-32 BE BOM' } as const

/** A small buffer with deliberately broken UTF-8, to show what the inspector flags. */
function brokenSample(): Uint8Array {
  const te = new TextEncoder()
  const parts: number[] = [0xef, 0xbb, 0xbf, ...te.encode('Valid: héllo ✓ 😀\n')]
  parts.push(...te.encode('Truncated: '), 0xe2, 0x82, ...te.encode('\n'))
  parts.push(...te.encode('Lone continuation: '), 0x80, ...te.encode('\n'))
  parts.push(...te.encode('Overlong "/": '), 0xc0, 0xaf, ...te.encode('\n'))
  parts.push(...te.encode('Surrogate: '), 0xed, 0xa0, 0x80, ...te.encode('\n'))
  parts.push(...te.encode('Latin-1 é: caf'), 0xe9, ...te.encode('\n'))
  parts.push(...te.encode('Invalid byte: '), 0xff, 0xfe, ...te.encode('\n'))
  return Uint8Array.from(parts)
}

interface LoadedFile {
  name: string
  size: number
  mime: string
  bytes: Uint8Array
}

const bin = (b: number) => b.toString(2).padStart(8, '0')
const hex = (b: number, w = 2) => b.toString(16).toUpperCase().padStart(w, '0')

export default function Utf8Inspector() {
  const [source, setSource] = usePersistentState<'text' | 'file'>('source', 'text')
  const [text, setText] = usePersistentState('input', '')
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [selected, setSelected] = useState<ByteRange | null>(null)
  const [view, setView] = useState<'hex' | 'chars'>('hex')
  const [jump, setJump] = useState('')
  const isMobile = useIsMobile()
  const dump = useRef<HexDumpHandle>(null)
  const worker = useWorker<Tasks>(() => new UtfWorker())
  const fileStats = useTask<Utf8Stats>()

  const debounced = useDebouncedValue(text, adaptiveDelay(text.length))
  const textBytes = useMemo(() => new TextEncoder().encode(debounced), [debounced])
  const bytes = source === 'text' ? textBytes : (file?.bytes ?? EMPTY)
  const textStats = useMemo(() => (source === 'text' ? analyzeUtf8(textBytes) : null), [source, textBytes])
  const stats = source === 'text' ? textStats : fileStats.result && file ? fileStats.result : null

  useEffect(() => setSelected(null), [bytes])

  const loadBytes = (name: string, size: number, type: string, b: Uint8Array) => {
    setFile({ name, size, mime: type || sniffMime(b) || 'application/octet-stream', bytes: b })
    fileStats.reset()
    void fileStats.run((signal) => worker.run('analyze', b, signal))
  }

  const loadFile = async (f: File) => {
    if (f.size > MAX_FILE) {
      toast.error(`${f.name} is ${formatBytes(f.size)} — the inspector reads files fully into memory, up to ${formatBytes(MAX_FILE)}`)
      return
    }
    try {
      const b = new Uint8Array(await f.arrayBuffer())
      setSource('file')
      loadBytes(f.name, f.size, f.type, b)
    } catch (e) {
      toast.error(`Could not read ${f.name}`, { description: String(e) })
    }
  }

  const chooseFile = async () => {
    const f = await pickFile()
    if (f) void loadFile(f)
  }

  const goTo = (value: string) => {
    const v = value.trim()
    const n = /^0x[0-9a-f]+$/i.test(v) ? parseInt(v, 16) : /^\d+$/.test(v) ? Number(v) : NaN
    if (!Number.isFinite(n) || n < 0 || n >= bytes.length) {
      toast.error(bytes.length ? `Enter an offset between 0 and ${bytes.length - 1} (decimal or 0x hex)` : 'Nothing to inspect yet')
      return
    }
    const seq = sequenceContaining(bytes, n)
    setView('hex')
    setSelected({ start: seq.start, length: seq.length })
    requestAnimationFrame(() => dump.current?.reveal(n))
  }

  const selectAndReveal = (r: ByteRange) => {
    setSelected(r)
    if (view === 'hex') dump.current?.reveal(r.start)
  }

  const toolbar = (
    <Toolbar>
      <Segmented
        aria-label="Source"
        value={source}
        onValueChange={setSource}
        options={[
          { value: 'text', label: 'Text' },
          { value: 'file', label: 'File' },
        ]}
      />
      {source === 'file' && (
        <>
          <ToolbarSeparator />
          <Button size="sm" onClick={chooseFile}>
            <FileUp /> {file ? 'Open another file' : 'Open file'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => loadBytes('broken-utf8-sample.txt', brokenSample().length, 'text/plain', brokenSample())}>
            <FlaskConical /> Sample with invalid bytes
          </Button>
        </>
      )}
      <ToolbarSeparator />
      <form
        className="flex items-center"
        onSubmit={(e) => {
          e.preventDefault()
          goTo(jump)
        }}
      >
        <ToolbarField label="Go to offset">
          <Input value={jump} onChange={(e) => setJump(e.target.value)} placeholder="0x1F or 31" className="mono h-7 w-28 text-[12.5px]" aria-label="Byte offset (decimal or 0x hex)" />
        </ToolbarField>
      </form>
      <ToolbarSpacer />
      {stats && <StatsBadges stats={stats} />}
    </Toolbar>
  )

  const showChars = source === 'text'
  const inspector = (
    <Pane aria-label="Bytes">
      <PaneHeader title={showChars ? undefined : 'Hex dump'} meta={bytes.length ? `${formatNumber(bytes.length)} bytes · ${formatNumber(Math.ceil(bytes.length / (isMobile ? 8 : 16)))} rows` : undefined}>
        {showChars && (
          <Segmented
            size="xs"
            aria-label="View"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'hex', label: 'Hex dump' },
              { value: 'chars', label: 'Characters' },
            ]}
          />
        )}
      </PaneHeader>
      {stats && <StatsStrip stats={stats} />}
      {!bytes.length ? (
        source === 'text' ? (
          <EmptyState icon={<ScanLine />} title="Type or paste text to see its UTF-8 bytes." description="Hover a byte to see which character it belongs to; click to pin it and inspect the bit pattern." />
        ) : (
          <EmptyState
            icon={<FileUp />}
            title="Open a file to inspect its bytes."
            description="Any file works — it is read locally as raw bytes (up to 512 MB) and never uploaded. Invalid UTF-8, BOMs and control bytes are highlighted."
            actions={
              <>
                <Button onClick={chooseFile}>Open file</Button>
                <Button variant="ghost" onClick={() => loadBytes('broken-utf8-sample.txt', brokenSample().length, 'text/plain', brokenSample())}>
                  Sample with invalid bytes
                </Button>
              </>
            }
          />
        )
      ) : view === 'chars' && showChars ? (
        <CharTable bytes={bytes} selected={selected} onSelect={setSelected} />
      ) : (
        <HexDump ref={dump} bytes={bytes} bytesPerRow={isMobile ? 8 : 16} bomLength={stats?.bom?.kind === 'utf-8' ? 3 : 0} selected={selected} onSelect={setSelected} />
      )}
      <SelectionDetail bytes={bytes} selected={selected} />
    </Pane>
  )

  const leftPane =
    source === 'text' ? (
      <InputEditorPane title="Text" value={text} onChange={setText} sample={TEXT_SAMPLE} placeholder="Type or paste text — it is encoded as UTF-8…" path="utf8-input" wordWrap />
    ) : (
      <Pane aria-label="File">
        <PaneHeader title="File" />
        <FileDropzone onFile={loadFile} maxBytes={MAX_FILE} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {file ? (
              <FileSummary file={file} stats={fileStats.result ?? null} running={fileStats.running} duration={fileStats.duration} onIssue={(o, l) => selectAndReveal({ start: o, length: l })} />
            ) : (
              <EmptyState compact icon={<FileUp />} title="Drop a file here" description="Or use “Open file” in the toolbar." />
            )}
          </div>
        </FileDropzone>
      </Pane>
    )

  return (
    <>
      {toolbar}
      <SplitPane id={`utf8-${source}`} initial={source === 'text' ? 0.36 : 0.3} mobileTabs={[source === 'text' ? 'Text' : 'File', 'Bytes']}>
        {leftPane}
        {inspector}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Bytes">{formatNumber(bytes.length)}</StatusItem>
        {stats && <StatusItem label="Characters">{formatNumber(stats.chars)}</StatusItem>}
        {stats && <StatusItem label="Lines">{formatNumber(stats.lines)}</StatusItem>}
        {stats && stats.invalidSequences > 0 && <StatusItem tone="danger">{pluralize(stats.invalidSequences, 'invalid sequence')}</StatusItem>}
        {source === 'file' && fileStats.running && <StatusItem>Analysing…</StatusItem>}
        <StatusSpacer />
        {selected && (
          <StatusItem label="Selected">
            {selected.start} (0x{hex(selected.start, 1)}) · {pluralize(selected.length, 'byte')}
          </StatusItem>
        )}
      </StatusBar>
    </>
  )
}

const EMPTY = new Uint8Array()

function StatsBadges({ stats }: { stats: Utf8Stats }) {
  if (!stats.byteLength) return null
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {stats.invalidSequences > 0 ? <Badge tone="danger">Invalid UTF-8</Badge> : stats.asciiOnly ? <Badge tone="neutral">ASCII only</Badge> : <Badge tone="ok">Valid UTF-8</Badge>}
      {stats.bom && <Badge tone="warn">{BOM_LABEL[stats.bom.kind]}</Badge>}
    </div>
  )
}

function StatsStrip({ stats }: { stats: Utf8Stats }) {
  if (!stats.byteLength) return null
  const items: [string, number, string?][] = [
    ['1-byte', stats.counts[1], 'ASCII'],
    ['2-byte', stats.counts[2], 'U+0080–07FF'],
    ['3-byte', stats.counts[3], 'U+0800–FFFF'],
    ['4-byte', stats.counts[4], 'emoji & astral'],
  ]
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-1.5 text-2xs">
      {items.map(([label, n, hint]) => (
        <span key={label} className="flex items-baseline gap-1" title={hint}>
          <span className="text-subtle">{label}</span>
          <span className={cn('tabular', n ? 'text-fg' : 'text-subtle')}>{formatNumber(n)}</span>
        </span>
      ))}
      <span className="flex items-baseline gap-1">
        <span className="text-subtle">invalid</span>
        <span className={cn('tabular', stats.invalidSequences ? 'text-danger' : 'text-subtle')}>
          {formatNumber(stats.invalidSequences)}
          {stats.invalidSequences ? ` (${pluralize(stats.invalidBytes, 'byte')})` : ''}
        </span>
      </span>
      {stats.bom && <span className="text-mod">{BOM_LABEL[stats.bom.kind]}</span>}
      {stats.bom && stats.bom.kind !== 'utf-8' && <span className="text-warn">This is not UTF-8 — the BOM says {stats.bom.kind.toUpperCase()}</span>}
      {stats.nulBytes > 0 && <span className="text-warn">{pluralize(stats.nulBytes, 'NUL byte')} — likely binary or UTF-16</span>}
      {stats.controlChars > 0 && <span className="text-subtle">{pluralize(stats.controlChars, 'control char')}</span>}
    </div>
  )
}

function SelectionDetail({ bytes, selected }: { bytes: Uint8Array; selected: ByteRange | null }) {
  if (!selected || selected.start >= bytes.length) {
    return bytes.length ? <div className="flex h-8 shrink-0 items-center border-t border-border px-3 text-2xs text-subtle">Hover a byte to highlight its character · click to pin it</div> : null
  }
  const seq = sequenceContaining(bytes, selected.start)
  const seqBytes = Array.from(bytes.subarray(seq.start, seq.start + seq.length))
  const valid = seq.cp !== -1
  const cat = valid ? generalCategory(seq.cp) : null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-bg/50 px-3 py-1.5 text-xs">
      <span className="flex items-baseline gap-1">
        <span className="text-subtle">offset</span>
        <span className="mono text-fg">
          {seq.start} · 0x{hex(seq.start, 1)}
        </span>
      </span>
      <span className="mono flex gap-2">
        {seqBytes.map((b, i) => (
          <span key={i} title={`0x${hex(b)}`}>
            <span className="text-fg">{hex(b)}</span> <BitPattern byte={b} lead={i === 0} length={seq.length} valid={valid} />
          </span>
        ))}
      </span>
      {valid ? (
        <span className="flex items-baseline gap-1.5">
          <span className="text-base leading-none text-fg">{seq.cp === 0x20 ? '␣' : seq.cp < 0x20 ? String.fromCodePoint(0x2400 + seq.cp) : String.fromCodePoint(seq.cp)}</span>
          <span className="mono text-accent-text">U+{hex(seq.cp, 4)}</span>
          <span className="text-muted">{CATEGORY_NAMES[cat!]}</span>
          <span className="text-subtle">· {seq.length}-byte sequence</span>
        </span>
      ) : (
        <span className="text-danger">{describeUtf8Problem(seq, bytes)}</span>
      )}
    </div>
  )
}

/** Bits with the UTF-8 marker prefix (0 / 110 / 1110 / 11110 / 10) dimmed. */
function BitPattern({ byte, lead, length, valid }: { byte: number; lead: boolean; length: number; valid: boolean }) {
  const bits = bin(byte)
  const prefix = !valid ? 0 : lead ? (length === 1 ? 1 : length + 1) : 2
  return (
    <span className="text-2xs">
      <span className="text-subtle">{bits.slice(0, prefix)}</span>
      <span className={valid ? 'text-muted' : 'text-danger'}>{bits.slice(prefix)}</span>
    </span>
  )
}

function FileSummary({
  file,
  stats,
  running,
  duration,
  onIssue,
}: {
  file: LoadedFile
  stats: Utf8Stats | null
  running: boolean
  duration: number | null
  onIssue: (offset: number, length: number) => void
}) {
  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-4 py-3">
        <p className="break-all text-sm font-medium text-fg">{file.name}</p>
        <p className="text-xs text-muted">
          {file.mime} · {formatBytes(file.size)} ({formatNumber(file.size)} bytes)
        </p>
      </div>
      {!stats ? (
        <p className="px-4 py-3 text-sm text-muted">{running ? 'Analysing…' : 'Waiting for analysis…'}</p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-border px-4 py-3 text-xs">
            <dt className="text-subtle">Encoding</dt>
            <dd className={stats.invalidSequences ? 'text-danger' : 'text-ok'}>
              {stats.invalidSequences ? 'Not valid UTF-8' : stats.asciiOnly ? 'ASCII (valid UTF-8)' : 'Valid UTF-8'}
            </dd>
            <dt className="text-subtle">BOM</dt>
            <dd className="text-fg">{stats.bom ? BOM_LABEL[stats.bom.kind] : 'None'}</dd>
            <dt className="text-subtle">Characters</dt>
            <dd className="text-fg tabular">{formatNumber(stats.chars)}</dd>
            <dt className="text-subtle">Lines</dt>
            <dd className="text-fg tabular">{formatNumber(stats.lines)}</dd>
            {duration != null && (
              <>
                <dt className="text-subtle">Scanned in</dt>
                <dd className="text-fg tabular">{formatDuration(duration)}</dd>
              </>
            )}
          </dl>
          {stats.issues.length > 0 && (
            <div>
              <h3 className="eyebrow flex h-8 items-center px-4">
                Invalid sequences{stats.invalidSequences > stats.issues.length ? ` · first ${formatNumber(stats.issues.length)} of ${formatNumber(stats.invalidSequences)}` : ''}
              </h3>
              <ul className="pb-2">
                {stats.issues.slice(0, 500).map((iss) => (
                  <li key={iss.offset}>
                    <button type="button" onClick={() => onIssue(iss.offset, iss.length)} className="flex w-full gap-3 px-4 py-1 text-left text-xs hover:bg-surface-2/60">
                      <span className="mono w-16 shrink-0 text-subtle">0x{hex(iss.offset, 1)}</span>
                      <span className="min-w-0 text-muted">{iss.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
