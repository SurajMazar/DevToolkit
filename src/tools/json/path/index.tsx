import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BookOpen, ListTree, Loader2, Route, Search, X } from 'lucide-react'
import type { Outcome, TaskError } from '@/engines/json-tools/tasks'
import { JSONPATH_SYNTAX, previewValue, type DocumentPath, type PathMatch, type QueryResult } from '@/engines/json-tools/jsonpath'
import { locatePointer } from '@/engines/json-tools/locate'
import { stringifyJson } from '@/engines/json/stringify'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useTask } from '@/hooks/useTask'
import { useWorker } from '@/hooks/useWorker'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { CodeEditorHandle, EditorMarker } from '@/components/editors/CodeEditor'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '@/components/ui/popover'
import { CopyButton } from '@/components/common/CopyButton'
import { DownloadButton } from '@/components/common/DownloadButton'
import { cn } from '@/utils/cn'
import { formatBytes, formatDuration, formatNumber, pluralize } from '@/utils/format'
import { TYPE_CLASS, TypeBadge, byteSize } from '../tree-viewer/values'
import ToolWorker from './worker.ts?worker'
import type { Tasks } from './worker'
import { PATH_EXAMPLES, PATH_SAMPLE } from './sample'

/** Filters can contain user regexes; a runaway query is stopped after this long. */
const QUERY_TIMEOUT_MS = 5000
const ROW = 30

type Mode = 'query' | 'paths'

function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, ms: number): Promise<T> {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, ms)
  return p(ctrl.signal)
    .catch((e) => {
      if (timedOut) throw new Error(`The query took longer than ${ms / 1000} s and was stopped. Simplify the filter (regular expressions can backtrack catastrophically).`)
      throw e
    })
    .finally(() => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    })
}

function SyntaxPopover({ onPick }: { onPick: (expr: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <BookOpen /> Syntax
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(560px,calc(100vw-24px))] p-0">
        <div className="grid max-h-[70vh] grid-cols-1 overflow-y-auto md:grid-cols-[1fr_1.15fr]">
          <div className="border-b border-border p-3 md:border-b-0 md:border-r">
            <p className="eyebrow mb-2">Syntax</p>
            <dl className="flex flex-col gap-1.5">
              {JSONPATH_SYNTAX.map((s) => (
                <div key={s.token} className="grid grid-cols-[112px_1fr] gap-2 text-xs">
                  <dt className="mono text-accent-text">{s.token}</dt>
                  <dd className="text-muted">{s.description}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-2xs leading-4 text-subtle">Filters run in a sandboxed expression interpreter — no JavaScript is evaluated.</p>
          </div>
          <div className="p-1.5">
            <p className="eyebrow px-1.5 pb-1.5 pt-1.5">Examples · click to run on the document</p>
            {PATH_EXAMPLES.map((e) => (
              <PopoverClose asChild key={e.expr}>
                <button type="button" onClick={() => onPick(e.expr)} className="flex w-full flex-col items-start rounded-md px-1.5 py-1 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="mono break-all text-xs text-fg">{e.expr}</span>
                  <span className="text-2xs text-subtle">{e.description}</span>
                </button>
              </PopoverClose>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function compactJson(v: unknown): string {
  const s = previewValue(v, 400)
  if (s.startsWith('[') || s.startsWith('{')) {
    const full = stringifyJson(v)
    return full.length > 400 ? full.slice(0, 399) + '…' : full
  }
  return s
}

function ResultRow({ m, index, top, height, stacked, onReveal }: { m: PathMatch; index: number; top: number; height: number; stacked: boolean; onReveal: (m: PathMatch) => void }) {
  return (
    <div
      role="row"
      className="group absolute left-0 flex w-full cursor-default items-center gap-3 border-b border-border/60 px-3 hover:bg-surface-2/60"
      style={{ top, height }}
      onClick={() => onReveal(m)}
      title={m.pointer ? 'Click to reveal in the document' : undefined}
    >
      <span className="w-6 shrink-0 text-right text-2xs text-subtle tabular">{index + 1}</span>
      <span className={cn('flex min-w-0 flex-1 gap-3', stacked ? 'flex-col gap-0.5' : 'items-center')}>
        <span className={cn('mono min-w-0 shrink-0 truncate text-xs text-accent-text', !stacked && 'w-[40%]')} title={m.path}>
          {m.path}
        </span>
        <span className={cn('mono min-w-0 flex-1 truncate text-xs', TYPE_CLASS[m.type])}>{compactJson(m.value)}</span>
      </span>
      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" onClick={(e) => e.stopPropagation()}>
        <CopyButton size="icon-xs" label="Copy path" value={m.path} />
        <CopyButton size="icon-xs" label="Copy value" value={() => stringifyJson(m.value, { indent: 2 })} />
      </span>
    </div>
  )
}

function VirtualList<T>({ items, render, label, rowHeight = ROW }: { items: T[]; render: (item: T, index: number, top: number) => React.ReactNode; label: string; rowHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: items.length, getScrollElement: () => ref.current, estimateSize: () => rowHeight, overscan: 12 })
  return (
    <div ref={ref} role="table" aria-label={label} className="h-full overflow-auto">
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>{v.getVirtualItems().map((it) => render(items[it.index], it.index, it.start))}</div>
    </div>
  )
}

export default function JsonPathExplorer() {
  const [input, setInput] = usePersistentState('input', '')
  const [query, setQuery] = usePersistentState('query', '$.store.book[*].title')
  const [mode, setMode] = usePersistentState<Mode>('mode', 'query')
  const [pathFilter, setPathFilter] = useState('')
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const isMobile = useIsMobile()
  const inputRef = useRef<CodeEditorHandle>(null)
  const queryRef = useRef<HTMLInputElement>(null)
  // Separate workers: cancelling a superseded query must not kill an in-flight path listing.
  const worker = useWorker<Tasks>(() => new ToolWorker({ name: 'json-path' }))
  const pathsWorker = useWorker<Tasks>(() => new ToolWorker({ name: 'json-path-list' }))
  const queryTask = useTask<Outcome<QueryResult>>()
  const pathsTask = useTask<Outcome<{ paths: DocumentPath[]; total: number; capped: boolean }>>()

  useIncomingInput(setInput)

  const doc = useDebouncedValue(input, adaptiveDelay(input.length))
  const expr = useDebouncedValue(query, 120)

  useEffect(() => {
    if (!doc.trim()) {
      queryTask.reset()
      return
    }
    void queryTask.run((signal) => withTimeout((s) => worker.run('runJsonPath', { text: doc, expr }, s), signal, QUERY_TIMEOUT_MS))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, expr])

  useEffect(() => {
    if (mode !== 'paths' || !doc.trim()) return
    void pathsTask.run((signal) => pathsWorker.run('listPaths', { text: doc, limit: 500_000 }, signal))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, mode])

  const outcome = queryTask.result
  const result = outcome?.ok ? outcome.value : null
  const err: TaskError | null = queryTask.error ? { message: queryTask.error.message, source: 'query' } : outcome && !outcome.ok ? outcome.error : null
  const docError = err?.source === 'document' ? err : null
  const queryError = err && err.source !== 'document' ? err : null

  const markers: EditorMarker[] | undefined = useMemo(() => (docError?.line ? [{ message: docError.message, line: docError.line, column: docError.column ?? 1 }] : undefined), [docError])

  const reveal = (m: PathMatch) => {
    if (!m.pointer && m.path !== '$') return
    const loc = locatePointer(input, m.pointer)
    const ed = inputRef.current?.editor
    if (!loc || !ed) return
    setMobileTab(0)
    const range = { startLineNumber: loc.line, startColumn: loc.column, endLineNumber: loc.endLine, endColumn: loc.endColumn }
    ed.setSelection(range)
    ed.revealRangeInCenterIfOutsideViewport(range)
  }

  const pick = (e: string) => {
    setQuery(e)
    setMode('query')
    setMobileTab(1)
    queueMicrotask(() => queryRef.current?.focus())
  }

  const paths = pathsTask.result?.ok ? pathsTask.result.value : null
  const filteredPaths = useMemo(() => {
    if (!paths) return []
    const f = pathFilter.trim().toLowerCase()
    return f ? paths.paths.filter((p) => p.path.toLowerCase().includes(f) || p.preview.toLowerCase().includes(f)) : paths.paths
  }, [paths, pathFilter])

  const allValues = () => stringifyJson(result?.matches.map((m) => m.value) ?? [], { indent: 2 })
  const allPaths = () => (result?.matches.map((m) => m.path) ?? []).join('\n')

  const queryBar = (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-workspace px-3 py-2">
      <Route className="size-4 shrink-0 text-subtle" aria-hidden />
      <div className="relative min-w-0 flex-1">
        <Input
          ref={queryRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="JSONPath query"
          aria-invalid={!!queryError}
          placeholder="$.store.book[?(@.price < 10)].title"
          className="mono h-8 pr-8 text-[13px]"
        />
        {queryTask.running && <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-subtle" aria-label="Running" />}
      </div>
      <SyntaxPopover onPick={pick} />
    </div>
  )

  const resultsBody = !input.trim() ? (
    <EmptyState
      icon={<Route />}
      title="Paste a JSON document, then write a query"
      description="Results update as you type. Filters such as [?(@.price < 10)] run in a sandboxed interpreter."
      actions={
        <Button size="sm" onClick={() => (inputRef.current?.editor ? inputRef.current.replaceAll(PATH_SAMPLE) : setInput(PATH_SAMPLE))}>
          Load bookstore sample
        </Button>
      }
    />
  ) : docError ? (
    <EmptyState compact title="Fix the document to run the query" description="The JSON on the left has a syntax error." />
  ) : queryError ? (
    <EmptyState compact title="Fix the query to see matches" description="Open Syntax for the supported operators and examples you can run with one click." />
  ) : result && result.matches.length === 0 && !queryError ? (
    <EmptyState compact title="No matches" description="The query is valid but selects nothing in this document. Try the paths view to see what exists." actions={<Button size="sm" variant="ghost" onClick={() => setMode('paths')}><ListTree /> Browse all paths</Button>} />
  ) : result ? (
    <VirtualList key={isMobile ? 'm' : 'd'} items={result.matches} label="Query results" rowHeight={isMobile ? 46 : ROW} render={(m, i, top) => <ResultRow key={i} m={m} index={i} top={top} height={isMobile ? 46 : ROW} stacked={isMobile} onReveal={reveal} />} />
  ) : null

  const pathsBody = !input.trim() ? (
    <EmptyState icon={<ListTree />} title="Every path in your document appears here" description="Paste JSON on the left, then filter the list and click a path to query it." />
  ) : pathsTask.result && !pathsTask.result.ok ? (
    <EmptyState compact title="Fix the document to list its paths" />
  ) : !paths ? (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" /> Listing paths…
    </div>
  ) : (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={pathFilter} onChange={(e) => setPathFilter(e.target.value)} placeholder="Filter paths or values" aria-label="Filter paths" className="h-7 pl-7" />
          {pathFilter && (
            <button type="button" aria-label="Clear filter" onClick={() => setPathFilter('')} className="absolute right-1.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center text-subtle hover:text-fg">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <span className="shrink-0 text-2xs text-subtle tabular">
          {formatNumber(filteredPaths.length)} / {formatNumber(paths.total)}
          {paths.capped && ' (first 500k listed)'}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <VirtualList
          items={filteredPaths}
          label="Document paths"
          render={(p, i, top) => (
            <div
              key={i}
              role="row"
              onClick={() => pick(p.path)}
              title="Click to query this path"
              className="group absolute left-0 flex w-full cursor-default items-center gap-3 border-b border-border/60 px-3 hover:bg-surface-2/60"
              style={{ top, height: ROW }}
            >
              <span className="mono min-w-0 flex-1 truncate text-xs text-fg" style={{ paddingLeft: Math.min(p.depth - 1, 8) * 10 }}>
                {p.path}
              </span>
              <TypeBadge type={p.type} className="hidden sm:inline-flex" />
              <span className={cn('mono hidden w-[30%] min-w-0 shrink-0 truncate text-xs md:block', TYPE_CLASS[p.type])}>{p.preview}</span>
              <span onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <CopyButton size="icon-xs" label="Copy path" value={p.path} />
              </span>
            </div>
          )}
        />
      </div>
    </div>
  )

  const resultsPane = (
    <Pane aria-label="Results">
      {mode === 'query' && queryBar}
      {mode === 'query' && queryError && <ErrorDisplay error={{ message: queryError.message + (queryError.column ? ` (column ${queryError.column})` : '') }} title="Query" />}
      <PaneHeader
        title={mode === 'query' ? 'Matches' : 'All paths'}
        meta={mode === 'query' && result ? `${pluralize(result.total, 'match', 'matches')}${result.capped ? ` · first ${formatNumber(result.matches.length)} shown` : ''}` : undefined}
        actions={
          mode === 'query' ? (
            <>
              <CopyButton showLabel size="xs" label="Copy paths" value={allPaths} disabled={!result?.matches.length} />
              <CopyButton showLabel size="xs" label="Copy values" tooltip="Copy all matched values as a JSON array" value={allValues} disabled={!result?.matches.length} />
              <DownloadButton getContent={allValues} filename="jsonpath-results.json" mime="application/json" label="Download results as JSON" disabled={!result?.matches.length} />
            </>
          ) : null
        }
      />
      <div className="relative min-h-0 flex-1">{mode === 'query' ? resultsBody : pathsBody}</div>
    </Pane>
  )

  return (
    <>
      <Toolbar>
        <Segmented
          aria-label="View"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'query', label: 'Query', icon: <Route /> },
            { value: 'paths', label: 'All paths', icon: <ListTree />, tooltip: 'Browse every path in the document to build a query' },
          ]}
        />
        <ToolbarSpacer />
        <span className="hidden text-xs text-subtle md:inline">Click a result to highlight it in the document</span>
      </Toolbar>
      <SplitPane id="json-path" initial={0.42} min={260} mobileTabs={['Document', mode === 'query' ? 'Results' : 'Paths']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        <InputEditorPane
          ref={inputRef}
          title="Document"
          value={input}
          onChange={setInput}
          language="json"
          sample={PATH_SAMPLE}
          accept=".json,application/json,text/plain"
          markers={markers}
          placeholder="Paste or drop a JSON document…"
          path="json-path-input"
        />
        <div className="flex min-h-0 flex-1 flex-col">
          {docError && (
            <ErrorDisplay
              error={{ message: docError.message, line: docError.line, column: docError.column }}
              title="Invalid JSON"
              onLocate={(l, c) => {
                setMobileTab(0)
                inputRef.current?.revealPosition(l, c)
              }}
            />
          )}
          {resultsPane}
        </div>
      </SplitPane>
      <StatusBar>
        <StatusItem label="Matches">{result ? formatNumber(result.total) : '—'}</StatusItem>
        {queryTask.duration != null && result && <StatusItem label="Took">{formatDuration(queryTask.duration)}</StatusItem>}
        {mode === 'paths' && paths && <StatusItem label="Paths">{formatNumber(paths.total)}</StatusItem>}
        <StatusSpacer />
        <StatusItem label="Document">{formatBytes(byteSize(input))}</StatusItem>
        <Badge tone="neutral" title="Filter expressions are interpreted safely; native eval is disabled">
          Safe evaluator
        </Badge>
      </StatusBar>
    </>
  )
}
