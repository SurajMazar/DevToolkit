import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRightLeft, Check, ClipboardPaste, Eraser, FileUp, PencilLine, Pilcrow, Sparkles, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  applyCleanups,
  hasAnyCleanup,
  indexLines,
  summarizeWhitespace,
  type CleanupOptions,
  type EolKind,
} from '@/engines/text-utils/whitespace'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { CodeEditor, type CodeEditorHandle } from '@/components/editors/CodeEditor'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { Pane, PaneBody, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { CopyButton } from '@/components/common/CopyButton'
import { DownloadButton } from '@/components/common/DownloadButton'
import { FileDropzone } from '@/components/common/FileDropzone'
import { readClipboardText } from '@/utils/clipboard'
import { pickFile } from '@/utils/files'
import { formatBytes, formatNumber, pluralize, utf8Length } from '@/utils/format'
import { modKey } from '@/utils/platform'
import { cn } from '@/utils/cn'
import { SAMPLE_WHITESPACE } from './sample'
import { Visualizer, type VisualizerHandle } from './Visualizer'
import { WhitespaceSummaryPanel } from './Summary'

interface CleanupUi {
  removeZeroWidth: boolean
  keepEmojiZwj: boolean
  removeFormatChars: boolean
  nbspToSpace: boolean
  unicodeSpacesToSpace: boolean
  trimTrailing: boolean
  eol: 'keep' | EolKind
  tabs: 'keep' | 'to-spaces' | 'to-tabs'
}

const DEFAULT_CLEANUP: CleanupUi = {
  removeZeroWidth: true,
  keepEmojiZwj: true,
  removeFormatChars: false,
  nbspToSpace: true,
  unicodeSpacesToSpace: false,
  trimTrailing: true,
  eol: 'keep',
  tabs: 'keep',
}

/** Decode a file as UTF-8 without stripping a BOM (Blob.text() would). */
async function readRaw(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf)
}

export default function WhitespaceVisualizer() {
  const [raw, setRaw] = usePersistentState('input', '')
  const [tabSize, setTabSize] = usePersistentState<'2' | '4' | '8'>('tabSize', '4')
  const [showSpaces, setShowSpaces] = usePersistentState('showSpaces', true)
  const [cleanup, setCleanup] = usePersistentState<CleanupUi>('cleanup', DEFAULT_CLEANUP)
  const [view, setView] = useState<'original' | 'cleaned'>('original')
  const [editing, setEditing] = useState(false)
  const [flash, setFlash] = useState<number | null>(null)
  const [mobileTab, setMobileTab] = useState<'text' | 'summary'>('text')
  const isMobile = useIsMobile()
  const vizRef = useRef<VisualizerHandle>(null)
  const editorRef = useRef<CodeEditorHandle>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useIncomingInput(setRaw)

  const tab = Number(tabSize)
  const cleanOpts: CleanupOptions = useMemo(
    () => ({
      removeZeroWidth: cleanup.removeZeroWidth,
      keepEmojiZwj: cleanup.keepEmojiZwj,
      removeFormatChars: cleanup.removeFormatChars,
      nbspToSpace: cleanup.nbspToSpace,
      unicodeSpacesToSpace: cleanup.unicodeSpacesToSpace,
      trimTrailing: cleanup.trimTrailing,
      normalizeEol: cleanup.eol === 'keep' ? null : cleanup.eol,
      tabs: cleanup.tabs === 'keep' ? null : cleanup.tabs,
      tabSize: tab,
    }),
    [cleanup, tab],
  )

  const source = useDeferredValue(raw)
  const cleaned = useMemo(() => (hasAnyCleanup(cleanOpts) ? applyCleanups(source, cleanOpts) : source), [source, cleanOpts])
  const shown = view === 'cleaned' ? cleaned : source
  const index = useMemo(() => indexLines(shown), [shown])
  const summary = useMemo(() => summarizeWhitespace(shown, index), [shown, index])
  const changed = cleaned !== source

  const setInput = useCallback(
    (text: string) => {
      setRaw(text)
      setView('original')
      setFlash(null)
    },
    [setRaw],
  )

  const loadFile = useCallback(
    async (file: File) => {
      try {
        const text = await readRaw(file)
        setInput(text)
        setEditing(false)
        toast.success(`Loaded ${file.name}`, { description: `${formatBytes(file.size)} — line endings and BOM preserved` })
      } catch (e) {
        toast.error(`Could not read ${file.name}`, { description: String(e) })
      }
    },
    [setInput],
  )

  const pasteFromClipboard = async () => {
    const text = await readClipboardText()
    if (text == null) {
      toast.message(`Clipboard read was blocked — click the text area and press ${modKey}+V`)
      return
    }
    setInput(text)
    setEditing(false)
  }

  // Paste anywhere in the tool (outside text fields) keeps the clipboard text byte-exact.
  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const t = e.target instanceof Element ? e.target : null
      if (editing || t?.closest('input, textarea, [contenteditable="true"], .monaco-editor')) return
      const text = e.clipboardData?.getData('text/plain')
      if (text == null || text === '') return
      e.preventDefault()
      setInput(text)
    },
    [editing, setInput],
  )
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const active = document.activeElement
      if (active && active !== document.body && !rootRef.current?.contains(active)) return
      onPaste(e)
    }
    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [onPaste])

  const jump = (pos: { line: number; column: number }) => {
    if (isMobile) setMobileTab('text')
    if (editing) {
      editorRef.current?.revealPosition(pos.line, pos.column)
      return
    }
    setFlash(pos.line)
    requestAnimationFrame(() => vizRef.current?.scrollToLine(pos.line))
  }

  const applyToInput = () => {
    const before = raw
    setInput(cleaned)
    toast.success('Cleanup applied to the input', {
      action: { label: 'Undo', onClick: () => setRaw(before) },
    })
  }

  const set = <K extends keyof CleanupUi>(k: K, v: CleanupUi[K]) => setCleanup((c) => ({ ...c, [k]: v }))
  const hasCr = raw.includes('\r')

  const headerActions = (
    <>
      {!editing && <IconButton label="Paste from clipboard (exact)" icon={<ClipboardPaste />} onClick={pasteFromClipboard} />}
      <IconButton label="Open file" icon={<FileUp />} onClick={async () => { const f = await pickFile(); if (f) void loadFile(f) }} />
      <IconButton label="Load sample" icon={<Sparkles />} onClick={() => { setInput(SAMPLE_WHITESPACE); setEditing(false) }} />
      <IconButton label="Clear" icon={<Eraser />} onClick={() => setInput('')} disabled={!raw} />
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <CopyButton value={() => shown} label={view === 'cleaned' ? 'Copy cleaned text' : 'Copy text'} disabled={!shown} />
      <DownloadButton getContent={() => shown} filename={view === 'cleaned' ? 'cleaned.txt' : 'text.txt'} label={view === 'cleaned' ? 'Download cleaned text' : 'Download text'} disabled={!shown} />
    </>
  )

  const textPane = (
    <Pane aria-label="Text">
      <PaneHeader
        title={editing ? 'Editing' : view === 'cleaned' ? 'Cleaned' : 'Revealed'}
        meta={!editing && view === 'cleaned' ? (changed ? 'preview of the cleanup result' : 'no changes with the current cleanup options') : undefined}
        actions={
          <>
            <Button size="xs" variant={editing ? 'primary' : 'ghost'} className="mr-1" onClick={() => { setEditing(!editing); setView('original') }}>
              {editing ? <Check /> : <PencilLine />} {editing ? 'Done' : 'Edit'}
            </Button>
            {headerActions}
          </>
        }
      />
      {editing && hasCr && (
        <ErrorDisplay
          severity="warning"
          error={`The editor normalizes line endings: typing here converts CR / CRLF to ${summary.eol.dominant ?? 'LF'} on every line. To inspect exact line endings, paste or open the file instead of editing.`}
        />
      )}
      <FileDropzone onFile={loadFile} className="flex min-h-0 flex-1 flex-col">
        <PaneBody>
          {editing ? (
            <CodeEditor ref={editorRef} value={raw} onChange={setRaw} ariaLabel="Edit text" path="whitespace-edit" placeholder="Type or paste text…" options={{ renderWhitespace: 'all', renderControlCharacters: true }} />
          ) : !raw ? (
            <div tabIndex={0} className="h-full outline-none" aria-label="Paste target">
              <EmptyState
                icon={<Pilcrow />}
                title="Paste text to reveal what you can't see"
                description={
                  <>
                    Press <span className="mono text-fg">{modKey}+V</span>, open or drop a file. Line endings, BOMs and every invisible character are kept exactly as pasted.
                  </>
                }
                actions={
                  <>
                    <Button size="sm" onClick={pasteFromClipboard}>
                      <ClipboardPaste /> Paste
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                      <PencilLine /> Type text
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setInput(SAMPLE_WHITESPACE)}>
                      <Sparkles /> Load sample
                    </Button>
                  </>
                }
              />
            </div>
          ) : (
            <Visualizer
              ref={vizRef}
              text={shown}
              index={index}
              tabSize={tab}
              showSpaces={showSpaces}
              dominantEol={summary.eol.dominant}
              mixedEol={summary.eol.mixed}
              flashLine={flash}
              longestLine={summary.longestLine}
              ariaLabel={view === 'cleaned' ? 'Cleaned text with visible whitespace' : 'Text with visible whitespace'}
            />
          )}
        </PaneBody>
      </FileDropzone>
    </Pane>
  )

  const cleanupPanel = (
    <section className="px-2 py-3">
      <h3 className="eyebrow mb-2 px-2">Clean up</h3>
      <div className="flex flex-col gap-2 px-2">
        <Checkbox checked={cleanup.removeZeroWidth} onCheckedChange={(v) => set('removeZeroWidth', v === true)} label="Remove zero-width characters" description="ZWSP, ZWNJ, ZWJ, word joiner, BOM" />
        {cleanup.removeZeroWidth && (
          <div className="ml-6">
            <Checkbox checked={cleanup.keepEmojiZwj} onCheckedChange={(v) => set('keepEmojiZwj', v === true)} label="Keep joiners inside emoji sequences" />
          </div>
        )}
        <Checkbox checked={cleanup.nbspToSpace} onCheckedChange={(v) => set('nbspToSpace', v === true)} label="No-break spaces → space" />
        <Checkbox checked={cleanup.unicodeSpacesToSpace} onCheckedChange={(v) => set('unicodeSpacesToSpace', v === true)} label="Unicode spaces → space" description="En, em, thin, ideographic…" />
        <Checkbox checked={cleanup.removeFormatChars} onCheckedChange={(v) => set('removeFormatChars', v === true)} label="Remove bidi & format characters" description="LRM, RLO, soft hyphen…" />
        <Checkbox checked={cleanup.trimTrailing} onCheckedChange={(v) => set('trimTrailing', v === true)} label="Trim trailing whitespace" />
        <div className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
          <span className="text-muted">Line endings</span>
          <Select
            aria-label="Normalize line endings"
            value={cleanup.eol}
            onValueChange={(v) => set('eol', v)}
            options={[
              { value: 'keep', label: 'Keep as is' },
              { value: 'LF', label: 'LF (Unix)' },
              { value: 'CRLF', label: 'CRLF (Windows)' },
              { value: 'CR', label: 'CR (classic Mac)' },
            ]}
          />
          <span className="text-muted">Indentation</span>
          <Select
            aria-label="Convert tabs and spaces"
            value={cleanup.tabs}
            onValueChange={(v) => set('tabs', v)}
            options={[
              { value: 'keep', label: 'Keep as is' },
              { value: 'to-spaces', label: `Tabs → ${tab} spaces`, description: 'All tabs, respecting tab stops' },
              { value: 'to-tabs', label: `Spaces → tabs`, description: `Leading indentation only (${tab} per tab)` },
            ]}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant={view === 'cleaned' ? 'secondary' : 'primary'} disabled={!raw} onClick={() => { setView(view === 'cleaned' ? 'original' : 'cleaned'); setEditing(false); if (isMobile) setMobileTab('text') }}>
            <ArrowRightLeft /> {view === 'cleaned' ? 'Show original' : 'Preview cleaned'}
          </Button>
          <CopyButton value={() => applyCleanups(raw, cleanOpts)} label="Copy cleaned" showLabel variant="secondary" disabled={!raw} />
          <Button size="sm" variant="ghost" disabled={!raw || !changed} onClick={applyToInput}>
            Apply to input
          </Button>
        </div>
      </div>
    </section>
  )

  const sidebar = (
    <aside aria-label="Summary and cleanup" className="flex min-h-0 flex-col overflow-y-auto bg-bg">
      {raw ? (
        <WhitespaceSummaryPanel summary={summary} onJump={jump} />
      ) : (
        <p className="border-b border-border px-4 py-3 text-sm text-subtle">Counts of every whitespace and invisible character appear here, each with a jump to its first occurrence.</p>
      )}
      {cleanupPanel}
    </aside>
  )

  const toolbar = (
    <Toolbar>
      <Segmented
        aria-label="Text shown"
        value={view}
        onValueChange={(v) => { setView(v); setEditing(false) }}
        options={[
          { value: 'original', label: 'Original' },
          { value: 'cleaned', label: 'Cleaned', disabled: !raw },
        ]}
      />
      <ToolbarSeparator />
      <ToolbarField label="Tab width">
        <Select aria-label="Tab width" value={tabSize} onValueChange={setTabSize} options={[{ value: '2', label: '2' }, { value: '4', label: '4' }, { value: '8', label: '8' }]} />
      </ToolbarField>
      <Checkbox checked={showSpaces} onCheckedChange={(v) => setShowSpaces(v === true)} label="Show spaces" />
      <ToolbarSpacer />
      {summary.eol.mixed && (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-warn">
          <TriangleAlert className="size-3.5" /> Mixed line endings
        </span>
      )}
    </Toolbar>
  )

  const invisibles = summary.counts['zero-width'].count + summary.counts.format.count + summary.counts.control.count + summary.counts['unicode-space'].count + summary.counts.nbsp.count + summary.counts['line-separator'].count

  const status = (
    <StatusBar>
      <StatusItem label="Lines">{formatNumber(summary.lines)}</StatusItem>
      <StatusItem label="Size">{formatBytes(utf8Length(shown))}</StatusItem>
      <StatusItem label="Invisible" tone={invisibles ? 'mod' : undefined}>{formatNumber(invisibles)}</StatusItem>
      <StatusItem label="Trailing" tone={summary.counts.trailing.count ? 'del' : undefined}>{pluralize(summary.counts.trailing.count, 'line')}</StatusItem>
      <StatusItem label="EOL" tone={summary.eol.mixed ? 'mod' : undefined}>{summary.eol.mixed ? 'Mixed' : (summary.eol.dominant ?? '—')}</StatusItem>
      <StatusSpacer />
      {changed && raw && <StatusItem label="Cleanup">{`${formatBytes(utf8Length(source))} → ${formatBytes(utf8Length(cleaned))}`}</StatusItem>}
      {!isMobile && <StatusItem label="Showing">{view === 'cleaned' ? 'Cleaned' : 'Original'}</StatusItem>}
    </StatusBar>
  )

  return (
    <div ref={rootRef} className="contents">
      {toolbar}
      {isMobile ? (
        <>
          <div className="flex shrink-0 items-center border-b border-border bg-bg px-3 py-1.5">
            <Segmented
              aria-label="Visible pane"
              value={mobileTab}
              onValueChange={setMobileTab}
              className="w-full [&>*]:flex-1 [&>*]:justify-center"
              options={[
                { value: 'text', label: 'Text' },
                { value: 'summary', label: 'Summary & cleanup' },
              ]}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{mobileTab === 'text' ? textPane : sidebar}</div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className={cn('flex w-[296px] shrink-0 flex-col border-r border-border xl:w-[320px]')}>{sidebar}</div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{textPane}</div>
        </div>
      )}
      {status}
    </div>
  )
}
