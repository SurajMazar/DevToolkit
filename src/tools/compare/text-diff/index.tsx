import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronDown, Columns2, Download, FileDiff, Loader2, PanelRight, Play, Rows3, Settings2, TriangleAlert, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { editor as MonacoEditor } from 'monaco-esm/editor/editor.api.js'
import { RowKind, splitLines, toUnifiedPatch, type TextDiffResult, type WhitespaceMode } from '@/engines/diff/text-diff'
import { parseJson } from '@/engines/json/parse'
import { stringifyJson } from '@/engines/json/stringify'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { createDiffWorker } from '@/workers/factories'
import type { DiffTasks } from '@/workers/diff.tasks'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { DiffViewer, type DiffGranularity, type DiffLayout, type DiffViewerHandle } from '@/components/tools/DiffViewer'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Field } from '@/components/ui/label'
import { HunkList, type HunkFilter } from './HunkList'
import { SAMPLE_A, SAMPLE_B } from './samples'
import { copyText } from '@/utils/clipboard'
import { downloadText } from '@/utils/download'
import { formatBytes, formatDuration, formatNumber } from '@/utils/format'
import { extensionOf } from '@/utils/files'
import { modKey } from '@/utils/platform'
import { cn } from '@/utils/cn'

/** Above this combined size, comparison runs only when explicitly requested. */
const AUTO_LIMIT = 4_000_000

const LANGUAGES = [
  { value: 'plaintext', label: 'Plain text' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
  { value: 'html', label: 'HTML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'css', label: 'CSS' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'sql', label: 'SQL' },
  { value: 'ini', label: '.env / INI' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'java', label: 'Java' },
  { value: 'rust', label: 'Rust' },
  { value: 'shell', label: 'Shell' },
]

const EXT_LANG: Record<string, string> = {
  json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml', svg: 'xml', html: 'html', htm: 'html', md: 'markdown', css: 'css', scss: 'css',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', sql: 'sql', env: 'ini', ini: 'ini',
  toml: 'ini', py: 'python', go: 'go', java: 'java', rs: 'rust', sh: 'shell', bash: 'shell', csv: 'plaintext', tsv: 'plaintext', log: 'plaintext', txt: 'plaintext',
}

interface Settings {
  layout: DiffLayout
  granularity: DiffGranularity
  whitespace: WhitespaceMode
  ignoreCase: boolean
  ignoreBlankLines: boolean
  wrap: boolean
  collapse: boolean
  context: number
  language: string
  showChanges: boolean
}

const DEFAULTS: Settings = {
  layout: 'split',
  granularity: 'word',
  whitespace: 'none',
  ignoreCase: false,
  ignoreBlankLines: false,
  wrap: false,
  collapse: false,
  context: 3,
  language: 'plaintext',
  showChanges: true,
}

interface Computed {
  result: TextDiffResult
  a: string
  b: string
  key: string
}

export default function TextDiff() {
  const [a, setA] = usePersistentState('a', '')
  const [b, setB] = usePersistentState('b', '')
  const [s, setS] = usePersistentState<Settings>('settings', DEFAULTS)
  const settings = { ...DEFAULTS, ...s }
  const set = (patch: Partial<Settings>) => setS({ ...settings, ...patch })
  const [view, setView] = usePersistentState<'input' | 'diff'>('view', 'input')
  const [names, setNames] = useState<[string, string]>(['original', 'modified'])
  const [activeHunk, setActiveHunk] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<HunkFilter>({ added: true, removed: true, modified: true })
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const isMobile = useIsMobile()
  const refA = useRef<CodeEditorHandle>(null)
  const refB = useRef<CodeEditorHandle>(null)
  const viewer = useRef<DiffViewerHandle>(null)
  const worker = useWorker<DiffTasks>(createDiffWorker)
  const task = useTask<Computed>()

  const total = a.length + b.length
  const auto = total <= AUTO_LIMIT
  const delay = total < 50_000 ? 120 : total < 1_000_000 ? 300 : 700
  const da = useDebouncedValue(a, delay)
  const db = useDebouncedValue(b, delay)
  const options = useMemo(
    () => ({ whitespace: settings.whitespace, ignoreCase: settings.ignoreCase, ignoreBlankLines: settings.ignoreBlankLines }),
    [settings.whitespace, settings.ignoreCase, settings.ignoreBlankLines],
  )
  const optKey = JSON.stringify(options)

  const compare = useCallback(
    (ta: string, tb: string) =>
      task.run(async (signal) => {
        const result = await worker.run('textDiff', { a: ta, b: tb, options }, signal)
        return { result, a: ta, b: tb, key: optKey }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [worker, optKey],
  )

  useEffect(() => {
    if (!auto) return
    if (!da && !db) {
      task.reset()
      return
    }
    void compare(da, db)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [da, db, compare, auto])

  const computed = task.result
  const stale = !computed || computed.a !== a || computed.b !== b || computed.key !== optKey
  const result = computed?.result
  const linesA = useMemo(() => (computed ? splitLines(computed.a) : []), [computed])
  const linesB = useMemo(() => (computed ? splitLines(computed.b) : []), [computed])
  const hunks = result?.hunks ?? []

  useEffect(() => setActiveHunk(0), [result])

  const runCompare = () => {
    void compare(a, b)
    setView('diff')
  }

  const go = useCallback(
    (dir: 1 | -1) => {
      if (!hunks.length) return
      const next = (activeHunk + dir + hunks.length) % hunks.length
      setActiveHunk(next)
      if (view === 'diff') viewer.current?.scrollToHunk(next)
      else {
        const h = hunks[next]
        refA.current?.editor?.revealLineInCenter(h.aStart + 1)
        refB.current?.editor?.revealLineInCenter(h.bStart + 1)
      }
    },
    [hunks, activeHunk, view],
  )

  // Keyboard: F7 / Shift+F7 or Alt+↓/↑ to move between changes; Ctrl/⌘+Enter to compare.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F7' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
        e.preventDefault()
        go(e.shiftKey || e.key === 'ArrowUp' ? -1 : 1)
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        runCompare()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Decorate changed lines inside the input editors.
  const decoA = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null)
  const decoB = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null)
  useEffect(() => {
    if (view !== 'input') return
    const edA = refA.current?.editor
    const edB = refB.current?.editor
    const monaco = refA.current?.monaco
    if (!edA || !edB || !monaco) return
    decoA.current ??= edA.createDecorationsCollection()
    decoB.current ??= edB.createDecorationsCollection()
    if (!result || stale || result.kinds.length > 400_000) {
      decoA.current.clear()
      decoB.current.clear()
      return
    }
    const da: MonacoEditor.IModelDeltaDecoration[] = []
    const dbb: MonacoEditor.IModelDeltaDecoration[] = []
    const { kinds, aIdx, bIdx } = result
    for (let i = 0; i < kinds.length && da.length + dbb.length < 50_000; i++) {
      const k = kinds[i]
      if (k === RowKind.Removed || k === RowKind.Modified) da.push({ range: new monaco.Range(aIdx[i] + 1, 1, aIdx[i] + 1, 1), options: { isWholeLine: true, className: 'dt-line-del', linesDecorationsClassName: 'dt-gutter-del' } })
      if (k === RowKind.Added || k === RowKind.Modified) dbb.push({ range: new monaco.Range(bIdx[i] + 1, 1, bIdx[i] + 1, 1), options: { isWholeLine: true, className: 'dt-line-add', linesDecorationsClassName: 'dt-gutter-add' } })
    }
    decoA.current.set(da)
    decoB.current.set(dbb)
  }, [result, stale, view])
  useEffect(() => {
    // Editors remount when switching views; drop stale collections.
    decoA.current = null
    decoB.current = null
  }, [view, isMobile])

  const swap = () => {
    const ta = a
    const tb = b
    if (refA.current?.editor && refB.current?.editor) {
      refA.current.replaceAll(tb)
      refB.current.replaceAll(ta)
    } else {
      setA(tb)
      setB(ta)
    }
    setNames([names[1], names[0]])
  }

  const prepare = (kind: 'json' | 'json-sort' | 'sort-lines' | 'trim') => {
    const apply = (text: string, side: 'Original' | 'Modified'): string | null => {
      if (kind === 'json' || kind === 'json-sort') {
        const r = parseJson(text)
        if (!r.ok) {
          toast.error(`${side} is not valid JSON`, { description: `${r.error.message} (line ${r.error.line}, column ${r.error.column})` })
          return null
        }
        return stringifyJson(r.value, { indent: 2, sortKeys: kind === 'json-sort' })
      }
      if (kind === 'sort-lines') return splitLines(text).sort((x, y) => x.localeCompare(y)).join('\n')
      return splitLines(text).map((l) => l.replace(/\s+$/, '')).join('\n')
    }
    const na = a ? apply(a, 'Original') : a
    const nb = b ? apply(b, 'Modified') : b
    if (na === null || nb === null) return
    refA.current?.editor ? refA.current.replaceAll(na) : setA(na)
    refB.current?.editor ? refB.current.replaceAll(nb) : setB(nb)
    if (kind === 'json' || kind === 'json-sort') set({ language: 'json' })
    toast.success('Both inputs updated', { description: 'Undo with Ctrl/⌘+Z inside each editor.' })
  }

  const patch = () => (result && computed ? toUnifiedPatch(linesA, linesB, result, { context: 3, nameA: `a/${names[0]}`, nameB: `b/${names[1]}` }) : '')

  const onFileLoaded = (side: 0 | 1) => (name: string) => {
    const lang = EXT_LANG[extensionOf(name)]
    if (lang) set({ language: lang })
    setNames((n) => (side === 0 ? [name, n[1]] : [n[0], name]))
  }

  const layout: DiffLayout = isMobile ? 'unified' : settings.layout
  const bothEmpty = !a && !b

  // ── Toolbar ──────────────────────────────────────────────────────────────────
  const toolbar = (
    <Toolbar>
      <Segmented
        aria-label="View"
        value={view}
        onValueChange={(v) => (v === 'diff' && !auto && stale ? runCompare() : setView(v))}
        options={[
          { value: 'input', label: 'Edit', tooltip: 'Edit both texts' },
          { value: 'diff', label: 'Diff', tooltip: `Review differences (${modKey}+Enter)` },
        ]}
      />
      {view === 'diff' && !isMobile && (
        <Segmented
          aria-label="Layout"
          value={settings.layout}
          onValueChange={(layout) => set({ layout })}
          options={[
            { value: 'split', label: 'Split', icon: <Columns2 />, tooltip: 'Side-by-side' },
            { value: 'unified', label: 'Unified', icon: <Rows3 />, tooltip: 'Unified (inline) view' },
          ]}
        />
      )}
      <ToolbarSeparator />
      <ToolbarField label="Highlight">
        <Select
          aria-label="Highlight granularity"
          value={settings.granularity}
          onValueChange={(granularity) => set({ granularity })}
          options={[
            { value: 'word', label: 'Words' },
            { value: 'char', label: 'Characters' },
            { value: 'line', label: 'Lines only' },
          ]}
        />
      </ToolbarField>
      <ToolbarField label="Whitespace">
        <Select
          aria-label="Whitespace handling"
          value={settings.whitespace}
          onValueChange={(whitespace) => set({ whitespace })}
          options={[
            { value: 'none', label: 'Compare all', description: 'Every space counts' },
            { value: 'trailing', label: 'Ignore trailing' },
            { value: 'leading-trailing', label: 'Ignore leading & trailing' },
            { value: 'collapse', label: 'Ignore amount', description: 'Runs of spaces are equal' },
            { value: 'all', label: 'Ignore all whitespace' },
          ]}
        />
      </ToolbarField>
      <Checkbox checked={settings.ignoreCase} onCheckedChange={(v) => set({ ignoreCase: v === true })} label="Ignore case" />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn((settings.ignoreBlankLines || settings.wrap || settings.collapse) && 'text-accent-text')}>
            <Settings2 /> View
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <div className="flex flex-col gap-3">
            <Checkbox checked={settings.ignoreBlankLines} onCheckedChange={(v) => set({ ignoreBlankLines: v === true })} label="Ignore blank lines" description="Blank lines are shown faded and not counted" />
            <Checkbox checked={settings.wrap} onCheckedChange={(v) => set({ wrap: v === true })} label="Wrap long lines" />
            <Checkbox checked={settings.collapse} onCheckedChange={(v) => set({ collapse: v === true })} label="Show only changes" description="Collapse unchanged regions" />
            {settings.collapse && (
              <Field label="Context lines">
                <Segmented aria-label="Context lines" value={String(settings.context)} onValueChange={(v) => set({ context: Number(v) })} options={['0', '1', '3', '5', '10'].map((v) => ({ value: v, label: v }))} />
              </Field>
            )}
            <Field label="Syntax (editors)">
              <Select aria-label="Language" value={settings.language} onValueChange={(language) => set({ language })} options={LANGUAGES} />
            </Field>
          </div>
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={bothEmpty}>
            <Wand2 /> Prepare <ChevronDown className="!size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Normalize both inputs</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => prepare('json')}>Format as JSON</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => prepare('json-sort')}>Format as JSON, sort keys</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => prepare('sort-lines')}>Sort lines</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => prepare('trim')}>Trim trailing whitespace</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarSpacer />
      <div className="flex items-center gap-0.5">
        <IconButton label="Previous change" shortcut={['⇧', 'F7']} icon={<ArrowUp />} onClick={() => go(-1)} disabled={!hunks.length} />
        <span className="min-w-14 text-center text-xs text-muted tabular">{hunks.length ? `${activeHunk + 1} / ${formatNumber(hunks.length)}` : '0 / 0'}</span>
        <IconButton label="Next change" shortcut={['F7']} icon={<ArrowDown />} onClick={() => go(1)} disabled={!hunks.length} />
      </div>
      <ToolbarSeparator />
      <IconButton label="Swap sides" icon={<ArrowLeftRight />} onClick={swap} disabled={bothEmpty} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={!result || result.identical}>
            <Download /> Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={async () => toast[(await copyText(patch())) ? 'success' : 'error']('Unified diff copied')}>
            <FileDiff /> Copy unified diff
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => downloadText(patch(), `${names[0].replace(/\.[^.]+$/, '')}.patch`, 'text/x-diff')}>
            <Download /> Download .patch
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={async () => {
              if (!result) return
              const st = result.stats
              await copyText(`${formatNumber(st.added)} added, ${formatNumber(st.removed)} removed (${formatNumber(st.modified)} modified) in ${formatNumber(hunks.length)} change blocks; ${Math.round(st.similarity * 100)}% of lines unchanged.`)
              toast.success('Summary copied')
            }}
          >
            Copy summary
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {view === 'diff' && !isMobile && (
        <IconButton label={settings.showChanges ? 'Hide changes panel' : 'Show changes panel'} icon={<PanelRight />} onClick={() => set({ showChanges: !settings.showChanges })} aria-pressed={settings.showChanges} />
      )}
    </Toolbar>
  )

  // ── Body ─────────────────────────────────────────────────────────────────────
  const emptyState = (
    <EmptyState
      icon={<FileDiff />}
      title="Paste text into both editors to compare them line by line."
      description="Or drop a file on each side. Large files are compared in a background thread."
      actions={
        <Button
          onClick={() => {
            refA.current?.editor ? refA.current.replaceAll(SAMPLE_A) : setA(SAMPLE_A)
            refB.current?.editor ? refB.current.replaceAll(SAMPLE_B) : setB(SAMPLE_B)
            set({ language: 'javascript' })
          }}
        >
          Load example
        </Button>
      }
    />
  )

  const inputs = (
    <SplitPane id="text-diff-inputs" mobileTabs={['Original', 'Modified']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
      <InputEditorPane
        ref={refA}
        title="Original"
        value={a}
        onChange={setA}
        language={settings.language}
        path="diff-a"
        onFileLoaded={onFileLoaded(0)}
        sample={SAMPLE_A}
        emptyState={bothEmpty ? emptyState : <EmptyState compact title="Paste or drop the original text" />}
        footer={result && !stale ? <span className="flex gap-3"><span>{formatNumber(result.stats.linesA)} lines</span><span className="text-del">−{formatNumber(result.stats.removed)}</span><span>{formatBytes(a.length)}</span></span> : undefined}
      />
      <InputEditorPane
        ref={refB}
        title="Modified"
        value={b}
        onChange={setB}
        language={settings.language}
        path="diff-b"
        onFileLoaded={onFileLoaded(1)}
        sample={SAMPLE_B}
        emptyState={<EmptyState compact title="Paste or drop the modified text" description={bothEmpty ? 'Differences are highlighted as you type.' : undefined} />}
        footer={result && !stale ? <span className="flex gap-3"><span>{formatNumber(result.stats.linesB)} lines</span><span className="text-add">+{formatNumber(result.stats.added)}</span><span>{formatBytes(b.length)}</span></span> : undefined}
      />
    </SplitPane>
  )

  let diffBody: React.ReactNode
  if (bothEmpty) diffBody = emptyState
  else if (!result) {
    diffBody = (
      <EmptyState
        icon={task.running ? <Loader2 className="animate-spin" /> : <Play />}
        title={task.running ? 'Comparing…' : 'Ready to compare'}
        description={task.running ? 'Large inputs are diffed in a background thread — the page stays responsive.' : `Inputs total ${formatBytes(total)}. Run the comparison when you're ready.`}
        actions={task.running ? <Button onClick={task.cancel}><X /> Cancel</Button> : <Button variant="primary" onClick={runCompare}><Play /> Compare</Button>}
      />
    )
  } else if (result.identical) {
    diffBody = (
      <EmptyState
        icon={<FileDiff />}
        title="No differences"
        description={
          options.whitespace !== 'none' || options.ignoreCase || options.ignoreBlankLines
            ? 'The inputs are identical with the current ignore options.'
            : `Both inputs are identical (${formatNumber(result.stats.linesA)} lines).`
        }
      />
    )
  } else {
    diffBody = (
      <div className="flex min-h-0 flex-1">
        <DiffViewer
          ref={viewer}
          linesA={linesA}
          linesB={linesB}
          result={result}
          layout={layout}
          granularity={settings.granularity}
          ignoreCase={settings.ignoreCase}
          whitespace={settings.whitespace}
          wrap={settings.wrap || isMobile}
          collapse={settings.collapse}
          context={settings.context}
          activeHunk={activeHunk}
          search={query.trim() || undefined}
          labels={[names[0], names[1]]}
        />
        {settings.showChanges && !isMobile && (
          <aside className="flex w-[280px] shrink-0 flex-col border-l border-border bg-bg xl:w-[320px]" aria-label="Changes">
            <div className="flex h-8 shrink-0 items-center border-b border-border px-3">
              <h2 className="eyebrow">Changes</h2>
            </div>
            <HunkList
              result={result}
              linesA={linesA}
              linesB={linesB}
              active={activeHunk}
              onSelect={(i) => {
                setActiveHunk(i)
                viewer.current?.scrollToHunk(i)
              }}
              query={query}
              onQuery={setQuery}
              filter={filter}
              onFilter={setFilter}
            />
          </aside>
        )}
      </div>
    )
  }

  const banner =
    view === 'diff' && result && stale ? (
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-3 py-1.5 text-xs text-muted">
        {task.running ? <Loader2 className="size-3.5 animate-spin" /> : <TriangleAlert className="size-3.5 text-warn" />}
        <span className="flex-1">{task.running ? 'Updating comparison…' : 'The inputs or options changed since this comparison.'}</span>
        {task.running ? (
          <Button size="xs" variant="ghost" onClick={task.cancel}>Cancel</Button>
        ) : (
          <Button size="xs" variant="primary" onClick={runCompare}>Re-compare</Button>
        )}
      </div>
    ) : null

  return (
    <>
      {toolbar}
      {task.error && <ErrorDisplay error={task.error.message} />}
      {result?.approximate && (
        <ErrorDisplay
          severity="warning"
          error="The inputs differ so extensively that the comparison hit its time budget. The result is correct but not minimal — some unchanged lines may be shown as replaced."
        />
      )}
      {banner}
      <div className="flex min-h-0 flex-1 flex-col">{view === 'input' ? inputs : diffBody}</div>
      <StatusBar>
        {result ? (
          <>
            <StatusItem tone="add">+{formatNumber(result.stats.added)}</StatusItem>
            <StatusItem tone="del">−{formatNumber(result.stats.removed)}</StatusItem>
            <StatusItem label="Modified">{formatNumber(result.stats.modified)}</StatusItem>
            <StatusItem label="Blocks">{formatNumber(hunks.length)}</StatusItem>
            <StatusItem label="Unchanged">{Math.round(result.stats.similarity * 100)}%</StatusItem>
          </>
        ) : (
          <StatusItem>{bothEmpty ? 'Waiting for input' : task.running ? 'Comparing…' : auto ? 'Ready' : `Large input (${formatBytes(total)}) — press Compare`}</StatusItem>
        )}
        <StatusSpacer />
        {result && <StatusItem label="Lines">{formatNumber(result.stats.linesA)} → {formatNumber(result.stats.linesB)}</StatusItem>}
        {task.duration != null && result && <StatusItem label="Diff">{formatDuration(result.elapsedMs)}</StatusItem>}
        {!auto && view === 'input' && (
          <Button size="xs" variant="primary" onClick={runCompare} className="ml-1">
            <Play /> Compare
          </Button>
        )}
      </StatusBar>
    </>
  )
}
