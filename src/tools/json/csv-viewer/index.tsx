import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, ClipboardPaste, Columns3, Copy, Download, Eraser, FileUp, Filter, Loader2, Maximize2, Search, Sparkles, Table2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Segmented } from '@/components/ui/segmented'
import { CopyButton } from '@/components/common/CopyButton'
import { FileDropzone } from '@/components/common/FileDropzone'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useTask } from '@/hooks/useTask'
import { useWorker } from '@/hooks/useWorker'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { delimiterLabel, linebreakLabel } from '@/engines/data/csv'
import { cellAt, exportCsv, exportJson, filterRows, sortOrder, type ColumnStats, type ColumnType, type Dataset, type DatasetOptions, type ProgressInfo } from '@/engines/data/table'
import { copyText, readClipboardText } from '@/utils/clipboard'
import { downloadText } from '@/utils/download'
import { pickFile } from '@/utils/files'
import { cn } from '@/utils/cn'
import { formatBytes, formatDuration, formatNumber } from '@/utils/format'
import { DataGrid, estimateWidth, type GridCell, type GridColumn } from './shared/DataGrid'
import { DelimiterField } from './shared/DelimiterField'
import { IssuesBanner } from './shared/IssuesBanner'
import { useColumnWidths } from './shared/useColumnWidths'
import { sampleCsv } from './sample'
import ToolWorker from './worker.ts?worker'
import type { ProgressMessage, Tasks } from './worker'

const DEFAULT_OPTS: DatasetOptions = { delimiter: '', quoteChar: '"', header: true, skipEmptyLines: true }
/** Above this many rows, sorting runs in the worker. */
const SORT_IN_WORKER = 40_000

const TYPE_HINT: Record<ColumnType, string> = { integer: 'int', decimal: 'dec', boolean: 'bool', date: 'date', text: '', empty: 'empty' }
const TYPE_LABEL: Record<ColumnType, string> = { integer: 'Integer', decimal: 'Decimal', boolean: 'Boolean', date: 'Date', text: 'Text', empty: 'Empty' }

interface Source {
  name: string
  text: string
}

export default function CsvViewer() {
  const [source, setSource] = usePersistentState<Source | null>('source', null)
  const [stored, setStored] = usePersistentState<Partial<DatasetOptions>>('options', {})
  const [showStats, setShowStats] = usePersistentState('showStats', true)
  const opts = useMemo(() => ({ ...DEFAULT_OPTS, ...stored }), [stored])
  const isMobile = useIsMobile()

  const [progress, setProgress] = useState<ProgressInfo | null>(null)
  const worker = useWorker<Tasks>(() => {
    const w = new ToolWorker({ name: 'csv-viewer' })
    w.addEventListener('message', (e: MessageEvent<ProgressMessage | { id: number }>) => {
      if ('type' in e.data && e.data.type === 'progress') setProgress(e.data)
    })
    return w
  })
  const sortWorker = useWorker<Tasks>(() => new ToolWorker({ name: 'csv-viewer-sort' }))
  const parse = useTask<Dataset>()
  const sortTask = useTask<{ order: Int32Array; key: string }>()

  const [sort, setSort] = useState<{ col: number; dir: 'asc' | 'desc' } | null>(null)
  const [query, setQuery] = useState('')
  const [colFilters, setColFilters] = useState<Record<number, string>>({})
  const [showFilters, setShowFilters] = useState(false)
  const [hidden, setHidden] = useState<string[]>([])
  const [selected, setSelected] = useState<GridCell | null>(null)
  const [inspect, setInspect] = useState<{ header: string; row: number; value: string } | null>(null)
  const [focusColumn, setFocusColumn] = useState<{ col: number; seq: number } | null>(null)
  const [mobileView, setMobileView] = useState<'table' | 'stats'>('table')

  useIncomingInput((text) => setSource({ name: 'From JSON to CSV', text }))

  const optsKey = JSON.stringify(opts)
  useEffect(() => {
    if (!source?.text) {
      parse.reset()
      setProgress(null)
      return
    }
    const text = source.text
    setProgress({ phase: 'parsing', progress: 0, rows: 0 })
    void parse.run((signal) => worker.run('parse', { text, opts }, signal)).finally(() => setProgress(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.text, optsKey])

  const ds = source?.text ? (parse.result ?? null) : null

  // Reset view state when a new dataset arrives.
  useEffect(() => {
    setSort(null)
    sortTask.reset()
    setColFilters({})
    setSelected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds])

  const loadFile = useCallback(
    async (f: File) => {
      try {
        const text = await f.text()
        setSource({ name: f.name, text })
      } catch (e) {
        toast.error(`Could not read ${f.name}`, { description: String(e) })
      }
    },
    [setSource],
  )

  const openFile = async () => {
    const f = await pickFile('.csv,.tsv,.tab,.txt,text/csv,text/tab-separated-values')
    if (f) void loadFile(f)
  }
  const pasteClipboard = async () => {
    const text = await readClipboardText()
    if (text == null) {
      toast.message('Clipboard read was blocked — press Ctrl/⌘+V anywhere on this page instead')
      return
    }
    if (!text.trim()) {
      toast.message('The clipboard is empty')
      return
    }
    setSource({ name: 'Pasted text', text })
  }

  // Paste anywhere on the page (outside inputs) loads CSV text.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target
      if (t instanceof Element && (t.closest('input, textarea, [contenteditable="true"], .monaco-editor') || (t as HTMLElement).isContentEditable)) return
      const text = e.clipboardData?.getData('text/plain')
      if (!text || !text.trim()) return
      e.preventDefault()
      setSource({ name: 'Pasted text', text })
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [setSource])

  // Columns
  const visibleCols = useMemo(() => (ds ? ds.headers.map((_, i) => i).filter((i) => !hidden.includes(ds.headers[i])) : []), [ds, hidden])
  const visibleHeaders = useMemo(() => visibleCols.map((c) => ds!.headers[c]), [visibleCols, ds])
  const defaults = useMemo(() => {
    if (!ds) return []
    // Sample rows spread over the whole file, not just the top.
    const step = Math.max(1, Math.floor(ds.rowCount / 300))
    return visibleCols.map((c) => {
      const sample: string[] = []
      for (let i = 0; i < ds.rowCount; i += step) sample.push(cellAt(ds.columns[c], i))
      return estimateWidth(ds.headers[c], sample, ds.stats[c].type === 'text' ? 0 : 24)
    })
  }, [ds, visibleCols])
  const [widths, onResize] = useColumnWidths(visibleHeaders, defaults)
  const gridColumns: GridColumn[] = useMemo(
    () => visibleCols.map((c, i) => ({ name: ds!.headers[c], width: widths[i] ?? 120, numeric: ds!.stats[c].type === 'integer' || ds!.stats[c].type === 'decimal', hint: TYPE_HINT[ds!.stats[c].type] || undefined })),
    [visibleCols, widths, ds],
  )

  // Sorting
  const sortKey = ds && sort ? `${sort.col}:${sort.dir}` : ''
  useEffect(() => {
    if (!ds || !sort) return
    const col = ds.columns[sort.col]
    const numeric = ds.numeric[sort.col]
    const key = `${sort.col}:${sort.dir}`
    if (ds.rowCount < SORT_IN_WORKER) void sortTask.run(() => ({ order: sortOrder(col, numeric, sort.dir), key }))
    else void sortTask.run(async (signal) => ({ order: await sortWorker.run('sort', { col, numeric, dir: sort.dir }, signal), key }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, sortKey])
  const order = sort && sortTask.result?.key === sortKey ? sortTask.result.order : undefined

  const onSort = (gridCol: number) => {
    const col = visibleCols[gridCol]
    setSort((s) => (s?.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null))
  }

  // Filtering (deferred so typing stays responsive on big tables)
  const dQuery = useDeferredValue(query)
  const dColFilters = useDeferredValue(colFilters)
  const filterMs = useRef(0)
  const view = useMemo(() => {
    if (!ds) return null
    const t0 = performance.now()
    const rows = filterRows(ds, { global: dQuery, columns: dColFilters, visible: visibleCols }, order)
    filterMs.current = performance.now() - t0
    return rows
  }, [ds, dQuery, dColFilters, visibleCols, order])
  // Selection is an index into the current view, so it's cleared when the view changes.
  useEffect(() => setSelected(null), [view])
  const filtering = query !== dQuery || colFilters !== dColFilters
  const activeColFilters = Object.values(colFilters).filter((v) => v.trim()).length
  const isFiltered = !!view && !!ds && view.length !== ds.rowCount

  const getCell = useCallback((r: number, c: number) => (ds && view ? cellAt(ds.columns[visibleCols[c]], view[r]) : ''), [ds, view, visibleCols])
  const rowLabel = useCallback((r: number) => (view ? view[r] + 1 : r + 1), [view])

  const selValue = selected && ds && view && selected.row < view.length && selected.col < visibleCols.length ? cellAt(ds.columns[visibleCols[selected.col]], view[selected.row]) : null
  const selHeader = selected && ds ? ds.headers[visibleCols[selected.col]] : ''
  const openInspector = (cell: GridCell) => {
    if (!ds || !view) return
    setInspect({ header: ds.headers[visibleCols[cell.col]], row: view[cell.row] + 1, value: cellAt(ds.columns[visibleCols[cell.col]], view[cell.row]) })
  }

  const baseName = (source?.name ?? 'data').replace(/\.[^.]+$/, '').replace(/\s+/g, '-').toLowerCase() || 'data'
  const exportAs = (kind: 'csv' | 'tsv' | 'json' | 'json-strings') => {
    if (!ds || !view) return
    const suffix = isFiltered ? '-filtered' : ''
    if (kind === 'csv') downloadText(exportCsv(ds, view, visibleCols), `${baseName}${suffix}.csv`, 'text/csv;charset=utf-8')
    else if (kind === 'tsv') downloadText(exportCsv(ds, view, visibleCols, { delimiter: '\t' }), `${baseName}${suffix}.tsv`, 'text/tab-separated-values;charset=utf-8')
    else downloadText(exportJson(ds, view, visibleCols, kind === 'json' ? undefined : false), `${baseName}${suffix}.json`, 'application/json')
  }
  const copyCsv = async () => {
    if (!ds || !view) return
    const ok = await copyText(exportCsv(ds, view, visibleCols))
    if (ok) toast.success(`Copied ${formatNumber(view.length)} rows as CSV`)
    else toast.error('Clipboard access was blocked by the browser')
  }

  const clear = () => {
    setSource(null)
    setQuery('')
    setHidden([])
  }

  const toolbar = (
    <Toolbar>
      <Button size="sm" variant="ghost" onClick={openFile}>
        <FileUp /> Open
      </Button>
      <IconButton label="Paste CSV from clipboard" icon={<ClipboardPaste />} onClick={pasteClipboard} />
      <IconButton label="Load sample (5,000 orders)" icon={<Sparkles />} onClick={() => setSource({ name: 'orders-sample.csv', text: sampleCsv() })} />
      <ToolbarSeparator />
      <DelimiterField value={opts.delimiter} onChange={(delimiter) => setStored((s) => ({ ...s, delimiter }))} allowAuto detected={opts.delimiter === '' ? ds?.delimiter : undefined} />
      <Checkbox checked={opts.header} onCheckedChange={(v) => setStored((s) => ({ ...s, header: v === true }))} label="Header row" />
      <ToolbarSeparator />
      <label className="relative flex shrink-0 items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-subtle" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows…"
          aria-label="Filter all visible columns"
          disabled={!ds}
          spellCheck={false}
          className="h-7 w-44 rounded-md border border-border bg-workspace pl-7 pr-6 text-sm text-fg outline-none placeholder:text-subtle hover:border-border-strong focus:border-accent disabled:opacity-50 lg:w-56"
        />
        {query && (
          <button type="button" aria-label="Clear filter" onClick={() => setQuery('')} className="absolute right-1.5 text-subtle hover:text-fg">
            <X className="size-3.5" />
          </button>
        )}
      </label>
      <Button size="sm" variant="ghost" onClick={() => setShowFilters(!showFilters)} aria-pressed={showFilters} disabled={!ds} className={cn((showFilters || activeColFilters > 0) && 'text-accent-text')}>
        <Filter /> Column filters{activeColFilters > 0 && ` (${activeColFilters})`}
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" disabled={!ds} className={cn(hidden.length > 0 && 'text-accent-text')}>
            <Columns3 /> {ds ? `${visibleCols.length}/${ds.headers.length}` : 'Columns'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="eyebrow">Visible columns</span>
            <span className="flex gap-1">
              <Button size="xs" variant="ghost" onClick={() => setHidden([])}>
                All
              </Button>
              <Button size="xs" variant="ghost" onClick={() => ds && setHidden(ds.headers.slice(1))}>
                First only
              </Button>
            </span>
          </div>
          <ul className="max-h-80 overflow-y-auto py-1">
            {ds?.headers.map((h) => (
              <li key={h} className="px-3 py-1">
                <Checkbox checked={!hidden.includes(h)} onCheckedChange={(v) => setHidden((x) => (v === true ? x.filter((k) => k !== h) : [...x, h]))} label={<span className="mono text-[12px]">{h}</span>} />
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <ToolbarSpacer />
      {!isMobile && (
        <Button size="sm" variant="ghost" onClick={() => setShowStats(!showStats)} aria-pressed={showStats} disabled={!ds} className={cn(showStats && ds && 'text-fg')}>
          <BarChart3 /> Stats
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" disabled={!ds || !view}>
            <Download /> Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60">
          <DropdownMenuLabel>
            {view ? `${formatNumber(view.length)} rows × ${visibleCols.length} columns` : ''}
            {isFiltered || sort ? ` · ${[isFiltered && 'filtered', sort && 'sorted'].filter(Boolean).join(', ')}` : ''}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => exportAs('csv')}>
            <Download /> CSV (comma)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => exportAs('tsv')}>
            <Download /> TSV (tab)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => exportAs('json')}>
            <Download /> JSON — typed values
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => exportAs('json-strings')}>
            <Download /> JSON — all strings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void copyCsv()}>
            <Copy /> Copy as CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton label="Close file" icon={<Eraser />} onClick={clear} disabled={!source} />
    </Toolbar>
  )

  // `progress` is set for the whole run (useTask's own flag only flips after 120 ms).
  const parsing = progress !== null
  const pct = progress ? Math.round(progress.progress * 100) : 0

  const cellBar = ds && (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-bg px-3 text-sm">
      {selValue !== null ? (
        <>
          <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 text-2xs text-muted tabular">
            <span className="mono">{selHeader}</span> · row {formatNumber(view![selected!.row] + 1)}
          </span>
          <span className={cn('mono min-w-0 flex-1 truncate text-[12.5px]', selValue ? 'text-fg' : 'text-subtle')}>{selValue ? selValue.replace(/\r\n|\n|\r/g, ' ↵ ') : '(empty)'}</span>
          <span className="shrink-0 text-2xs text-subtle tabular">{formatNumber(selValue.length)} chars</span>
          <CopyButton value={selValue} label="Copy cell value" size="icon-xs" />
          <IconButton label="Show full value" shortcut={['Enter']} size="icon-xs" icon={<Maximize2 />} onClick={() => selected && openInspector(selected)} />
        </>
      ) : (
        <span className="truncate text-xs text-subtle">{isMobile ? 'Tap a cell to see its full value · tap a header to sort' : 'Click a cell to see its full value · arrow keys move · Enter expands · click a header to sort'}</span>
      )}
    </div>
  )

  const filterInput = (gridCol: number) => {
    const col = visibleCols[gridCol]
    const type = ds?.stats[col].type
    const numericish = type === 'integer' || type === 'decimal' || type === 'date'
    return (
      <input
        value={colFilters[col] ?? ''}
        onChange={(e) => setColFilters((f) => ({ ...f, [col]: e.target.value }))}
        placeholder={type === 'date' ? '>2024-01-01' : numericish ? '>10, 1..5, =' : 'contains, =exact, !not'}
        aria-label={`Filter ${ds?.headers[col]}`}
        title="text contains · =exact · !not · = empty · != not empty · >10 >=10 <10 <=10 · 10..20 range"
        spellCheck={false}
        className="mono h-6 w-full rounded-sm border border-border bg-workspace px-1.5 text-[11.5px] text-fg outline-none placeholder:text-subtle focus:border-accent"
      />
    )
  }

  const grid = ds && view && (
    <DataGrid
      ariaLabel={source?.name ?? 'CSV data'}
      columns={gridColumns}
      rowCount={view.length}
      getCell={getCell}
      rowLabel={rowLabel}
      maxRowLabel={ds.rowCount}
      sort={sort ? { col: visibleCols.indexOf(sort.col), dir: sort.dir } : null}
      onSort={onSort}
      onResize={onResize}
      renderFilter={showFilters ? filterInput : undefined}
      selected={selected}
      onSelect={setSelected}
      onActivate={openInspector}
      focusColumn={focusColumn}
      empty={
        <EmptyState
          compact
          title={ds.rowCount ? 'No rows match the filters' : 'The file has a header but no rows'}
          actions={
            ds.rowCount ? (
              <Button
                size="sm"
                onClick={() => {
                  setQuery('')
                  setColFilters({})
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      }
    />
  )

  const statsPanel = ds && (
    <StatsPanel
      ds={ds}
      hidden={hidden}
      onFocus={(c) => {
        if (hidden.includes(ds.headers[c])) setHidden((h) => h.filter((x) => x !== ds.headers[c]))
        const gridCol = ds.headers.filter((h, i) => i <= c && (i === c || !hidden.includes(h))).length - 1
        setFocusColumn({ col: gridCol, seq: Date.now() })
        setSelected((s) => ({ row: s?.row ?? 0, col: gridCol }))
        if (isMobile) setMobileView('table')
      }}
    />
  )

  const body = !source?.text ? (
    <FileDropzone onFile={loadFile} className="flex min-h-0 flex-1 flex-col bg-workspace" label="Drop CSV or TSV to open">
      <EmptyState
        icon={<Table2 />}
        title="Open a CSV or TSV file"
        description="Drop a file here, open one, or paste with Ctrl/⌘+V. Files are parsed on this device in a background thread — 100k+ rows stay smooth."
        actions={
          <>
            <Button size="sm" variant="primary" onClick={openFile}>
              <FileUp /> Open file
            </Button>
            <Button size="sm" onClick={pasteClipboard}>
              <ClipboardPaste /> Paste
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSource({ name: 'orders-sample.csv', text: sampleCsv() })}>
              Load sample
            </Button>
          </>
        }
      />
    </FileDropzone>
  ) : (
    <FileDropzone onFile={loadFile} className="flex min-h-0 flex-1 flex-col bg-workspace" label="Drop to replace the current file">
      {parse.error && <ErrorDisplay error={parse.error.message} title="Could not parse the file" />}
      {ds && <IssuesBanner issues={ds.issues} rowLabel="record" />}
      {parsing && !ds ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <div className="flex items-center gap-2 text-sm text-fg">
            <Loader2 className="size-4 animate-spin text-subtle" />
            {progress?.phase === 'reading' ? 'Reading file…' : progress?.phase === 'analyzing' ? 'Computing column stats…' : `Parsing ${source.name}…`}
          </div>
          <div className="h-1 w-64 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted tabular">
            {pct}% · {formatNumber(progress?.rows ?? 0)} rows · {formatBytes(source.text.length)}
          </p>
          <Button size="sm" variant="ghost" onClick={() => parse.cancel()}>
            <X /> Cancel
          </Button>
        </div>
      ) : ds ? (
        isMobile ? (
          <>
            <div className="flex shrink-0 items-center border-b border-border bg-bg px-3 py-1.5">
              <Segmented aria-label="Visible pane" value={mobileView} onValueChange={setMobileView} className="w-full [&>*]:flex-1 [&>*]:justify-center" options={[{ value: 'table', label: 'Table' }, { value: 'stats', label: 'Column stats' }]} />
            </div>
            {mobileView === 'table' ? (
              <>
                {cellBar}
                {grid}
              </>
            ) : (
              statsPanel
            )}
          </>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {cellBar}
              {grid}
            </div>
            {showStats && <div className="flex w-[300px] shrink-0 flex-col border-l border-border xl:w-[320px]">{statsPanel}</div>}
          </div>
        )
      ) : (
        !parse.error && <EmptyState title="Parse cancelled" actions={<Button size="sm" onClick={() => setSource({ ...source })}>Parse again</Button>} />
      )}
    </FileDropzone>
  )

  return (
    <>
      {toolbar}
      {body}
      <StatusBar>
        {ds && view ? (
          <>
            <StatusItem label="Rows">{isFiltered ? `${formatNumber(view.length)} of ${formatNumber(ds.rowCount)}` : formatNumber(ds.rowCount)}</StatusItem>
            <StatusItem label="Columns">{visibleCols.length !== ds.headers.length ? `${visibleCols.length} of ${ds.headers.length}` : ds.headers.length}</StatusItem>
            <StatusItem label="Size">{formatBytes(ds.bytes)}</StatusItem>
            <span className="hidden max-w-60 truncate text-subtle md:inline" title={source?.name}>
              {source?.name}
            </span>
            {(filtering || sortTask.running) && (
              <StatusItem>
                <Loader2 className="size-3 animate-spin" aria-label="Working" />
              </StatusItem>
            )}
            <StatusSpacer />
            <StatusItem label="Delimiter">{`${delimiterLabel(ds.delimiter)}${ds.delimiterDetected ? ' (detected)' : ''}`}</StatusItem>
            <StatusItem label="Line endings">{linebreakLabel(ds.linebreak)}</StatusItem>
            <StatusItem label="Parsed in">{formatDuration(parse.duration ?? ds.parseMs)}</StatusItem>
            {sort && sortTask.duration != null && order && <StatusItem label="Sorted in">{formatDuration(sortTask.duration)}</StatusItem>}
            {(isFiltered || dQuery) && <StatusItem label="Filtered in">{formatDuration(filterMs.current)}</StatusItem>}
          </>
        ) : (
          <StatusItem>{parsing ? 'Parsing…' : 'No file open'}</StatusItem>
        )}
      </StatusBar>
      <Dialog open={!!inspect} onOpenChange={(o) => !o && setInspect(null)}>
        <DialogContent title={inspect ? inspect.header : ''} description={inspect ? `Row ${formatNumber(inspect.row)} · ${formatNumber(inspect.value.length)} characters` : undefined} className="max-w-2xl">
          <pre className="mono max-h-[52vh] overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-[12.5px] leading-5 text-fg">{inspect?.value || <span className="text-subtle">(empty)</span>}</pre>
          <div className="flex justify-end border-t border-border px-4 py-2.5">
            <CopyButton value={inspect?.value ?? ''} label="Copy value" showLabel variant="secondary" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function StatsPanel({ ds, hidden, onFocus }: { ds: Dataset; hidden: string[]; onFocus: (col: number) => void }) {
  return (
    <aside aria-label="Column statistics" className="flex min-h-0 flex-1 flex-col bg-workspace">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="eyebrow">Column stats</h2>
        <span className="text-2xs text-subtle tabular">{formatNumber(ds.rowCount)} rows</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {ds.headers.map((h, c) => (
          <StatRow key={c} name={h} stats={ds.stats[c]} rows={ds.rowCount} hidden={hidden.includes(h)} onClick={() => onFocus(c)} />
        ))}
      </ul>
    </aside>
  )
}

function StatRow({ name, stats: s, rows, hidden, onClick }: { name: string; stats: ColumnStats; rows: number; hidden: boolean; onClick: () => void }) {
  const filled = rows - s.empty
  const pct = rows ? filled / rows : 0
  return (
    <li>
      <button type="button" onClick={onClick} className={cn('flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left hover:bg-surface-2/50 focus-visible:bg-surface-2/50 focus-visible:outline-none', hidden && 'opacity-50')}>
        <span className="flex w-full items-center gap-2">
          <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-fg" title={name}>
            {name}
          </span>
          <span className="shrink-0 text-2xs text-muted">{TYPE_LABEL[s.type]}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <span className="block h-full rounded-full bg-accent/70" style={{ width: `${pct * 100}%` }} />
          </span>
          <span className="w-16 shrink-0 text-right text-2xs text-subtle tabular">{Math.round(pct * 1000) / 10}% filled</span>
        </span>
        <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-2xs tabular">
          <span className="text-subtle">Empty</span>
          <span className="text-muted">{formatNumber(s.empty)}</span>
          <span className="text-subtle">Unique</span>
          <span className="text-muted">
            {formatNumber(s.unique)}
            {s.uniqueCapped ? '+' : ''}
            {s.unique === filled + (s.empty ? 1 : 0) && filled > 1 ? ' · all distinct' : ''}
          </span>
          {s.min !== undefined ? (
            <>
              <span className="text-subtle">Min</span>
              <span className="mono truncate text-muted">{s.min}</span>
              <span className="text-subtle">Max</span>
              <span className="mono truncate text-muted">{s.max}</span>
            </>
          ) : (
            filled > 0 && (
              <>
                <span className="text-subtle">Length</span>
                <span className="text-muted">{s.minLength === s.maxLength ? s.minLength : `${s.minLength}–${s.maxLength}`} chars</span>
              </>
            )
          )}
        </span>
      </button>
    </li>
  )
}
