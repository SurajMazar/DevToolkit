import { useEffect, useMemo, useRef, useState } from 'react'
import { FileJson, Info, Loader2, Rows3, SlidersHorizontal, X } from 'lucide-react'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneBody, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { CodeEditor, type CodeEditorHandle, type EditorMarker } from '@/components/editors/CodeEditor'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CopyButton } from '@/components/common/CopyButton'
import { DownloadButton } from '@/components/common/DownloadButton'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useTask } from '@/hooks/useTask'
import { useWorker } from '@/hooks/useWorker'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { delimiterLabel, linebreakLabel, type InferredKind } from '@/engines/data/csv'
import { csvToJson, DEFAULT_CSV_TO_JSON, type CsvToJsonOptions, type CsvToJsonResult } from '@/engines/data/csv-to-json'
import { DataGrid, estimateWidth, type GridColumn } from '../csv-viewer/shared/DataGrid'
import { ColumnsPanel, type ColumnItem } from '../csv-viewer/shared/ColumnsPanel'
import { DelimiterField } from '../csv-viewer/shared/DelimiterField'
import { IssuesBanner } from '../csv-viewer/shared/IssuesBanner'
import { useColumnWidths } from '../csv-viewer/shared/useColumnWidths'
import { cn } from '@/utils/cn'
import { formatBytes, formatDuration, formatNumber, utf8Length } from '@/utils/format'
import ToolWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const WORKER_THRESHOLD = 150_000

const SAMPLE = `id,name,email,zip,signup_date,plan,seats,mrr,active,referrer.source,referrer.campaign
1001,Amelia Hart,amelia.hart@example.com,04101,2023-02-14,team,12,348.00,true,newsletter,spring-launch
1002,Kenji Watanabe,kenji.w@example.jp,530-0001,2023-03-02,pro,1,29.00,true,,
1003,"Fernández, Lucía",lucia.f@example.es,41001,2023-03-19,enterprise,250,6250.50,true,partner,"EU ""Q2"" push"
1004,Noah Okafor,noah@example.ng,100001,2023-04-07,free,1,0,false,search,
1005,Zoë Laurent,zoe.laurent@example.fr,75011,2023-05-21,team,8,232.00,TRUE,newsletter,spring-launch
1006,Priya Raman,priya.r@example.in,560001,2023-06-30,pro,3,87.00,false,"referral
(manual entry)",
`

const KIND_LABEL: Record<InferredKind, string> = { number: 'num', boolean: 'bool', string: 'str', null: 'null', mixed: 'mixed', empty: 'empty' }

export default function CsvToJson() {
  const [input, setInput] = usePersistentState('input', '')
  const [stored, setStored] = usePersistentState<Partial<CsvToJsonOptions>>('options', {})
  const [view, setView] = usePersistentState<'json' | 'table'>('view', 'json')
  const [showColumns, setShowColumns] = usePersistentState('showColumns', true)
  const [mobileTab, setMobileTab] = useState<'input' | 'output' | 'columns'>('input')
  const isMobile = useIsMobile()
  const inputRef = useRef<CodeEditorHandle>(null)
  useIncomingInput(setInput)

  const opts: CsvToJsonOptions = useMemo(() => ({ ...DEFAULT_CSV_TO_JSON, ...stored }), [stored])
  const set = (patch: Partial<CsvToJsonOptions>) => setStored((s) => ({ ...s, ...patch }))

  const debounced = useDebouncedValue(input, adaptiveDelay(input.length))
  const worker = useWorker<Tasks>(() => new ToolWorker({ name: 'csv-to-json' }))
  const task = useTask<CsvToJsonResult>()
  const optsKey = JSON.stringify(opts)

  useEffect(() => {
    if (!debounced.trim()) {
      task.reset()
      return
    }
    const text = debounced
    const o = opts
    void task.run((signal) => (text.length > WORKER_THRESHOLD ? worker.run('convert', { text, opts: o }, signal) : csvToJson(text, o)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, optsKey])

  const result = debounced.trim() ? task.result : undefined
  const stale = input !== debounced || task.running
  const json = result?.json ?? ''
  const jsonBytes = useMemo(() => (json.length < 5_000_000 ? utf8Length(json) : json.length), [json])
  const hasError = !!result?.issues.some((i) => i.severity === 'error')

  const markers: EditorMarker[] | undefined = useMemo(
    () => result?.issues.filter((i) => i.line).slice(0, 50).map((i) => ({ message: i.message, line: i.line!, column: i.column ?? 1, endColumn: i.column ? i.column + 1 : 200, severity: i.severity })),
    [result],
  )

  // Table preview of the parsed CSV (included columns, output names).
  const included = useMemo(() => (result?.columns ?? []).map((c, i) => ({ c, i })).filter((x) => x.c.included), [result])
  const dataStart = opts.header && result && result.rows.length ? 1 : 0
  const rowCount = result ? Math.max(0, result.rows.length - dataStart) : 0
  const keys = useMemo(() => included.map((x) => x.c.key), [included])
  const defaults = useMemo(() => {
    if (!result) return []
    const sample = result.rows.slice(dataStart, dataStart + 200)
    return included.map((x) => estimateWidth(x.c.key, sample.map((r) => r[x.i]), 24))
  }, [result, included, dataStart])
  const [widths, onResize] = useColumnWidths(keys, defaults)
  const gridColumns: GridColumn[] = useMemo(() => included.map((x, n) => ({ name: x.c.key, hint: KIND_LABEL[x.c.kind], numeric: x.c.kind === 'number', width: widths[n] ?? 120 })), [included, widths])

  const columnItems: ColumnItem[] = useMemo(() => (result?.columns ?? []).map((c) => ({ key: c.name, rename: opts.rename[c.name] ?? '', included: c.included, kind: KIND_LABEL[c.kind] })), [result, opts.rename])

  const typesActive = !opts.numbers || !opts.booleans || !opts.emptyAsNull || opts.trim || !opts.skipEmptyLines || opts.nested || opts.quoteChar !== '"'

  const toolbar = (
    <Toolbar>
      <DelimiterField value={opts.delimiter} onChange={(delimiter) => set({ delimiter })} allowAuto detected={opts.delimiter === '' ? result?.delimiter : undefined} />
      <Checkbox checked={opts.header} onCheckedChange={(v) => set({ header: v === true })} label="Header row" />
      <ToolbarSeparator />
      <ToolbarField label="Output">
        <Select
          aria-label="Output shape"
          value={opts.shape}
          onValueChange={(shape) => set({ shape, keyColumn: shape === 'keyed' && !opts.keyColumn ? (result?.columns[0]?.name ?? '') : opts.keyColumn })}
          options={[
            { value: 'objects', label: 'Array of objects', description: '[{"id":1,"name":"Ada"}, …]' },
            { value: 'arrays', label: 'Array of arrays', description: '[["id","name"], [1,"Ada"], …]' },
            { value: 'keyed', label: 'Object by key column', description: '{"Ada": {"id":1,…}, …}' },
          ]}
        />
      </ToolbarField>
      {opts.shape === 'keyed' && (
        <ToolbarField label="Key">
          <Select
            aria-label="Key column"
            value={opts.keyColumn || '__none'}
            onValueChange={(keyColumn) => set({ keyColumn })}
            options={result?.columns.length ? result.columns.map((c) => ({ value: c.name, label: c.name })) : [{ value: '__none', label: 'No columns', disabled: true }]}
            className="max-w-40"
          />
        </ToolbarField>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn(typesActive && 'text-accent-text')}>
            <SlidersHorizontal /> Parsing
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="flex flex-col gap-3">
            <p className="eyebrow">Type inference</p>
            <Checkbox checked={opts.numbers} onCheckedChange={(v) => set({ numbers: v === true })} label="Numbers" description="42, -3.5, 1e6. Leading zeros (02134) and over 15 digits stay text." />
            <Checkbox checked={opts.booleans} onCheckedChange={(v) => set({ booleans: v === true })} label="Booleans" description="true / false in any letter case" />
            <Checkbox checked={opts.emptyAsNull} onCheckedChange={(v) => set({ emptyAsNull: v === true })} label="Empty fields → null" description='Off: empty fields become ""' />
            <div className="h-px bg-border" />
            <p className="eyebrow">Reading</p>
            <Checkbox checked={opts.trim} onCheckedChange={(v) => set({ trim: v === true })} label="Trim whitespace" description="Around values and header names" />
            <Checkbox checked={opts.skipEmptyLines} onCheckedChange={(v) => set({ skipEmptyLines: v === true })} label="Skip empty lines" />
            <Checkbox checked={opts.nested} onCheckedChange={(v) => set({ nested: v === true })} label="Nested keys from headers" description="user.name → {user:{name}}, tags[0] → {tags:[…]}" />
            <Field label="Quote character">
              <Segmented
                aria-label="Quote character"
                value={opts.quoteChar === "'" ? 'single' : 'double'}
                onValueChange={(v) => set({ quoteChar: v === 'single' ? "'" : '"' })}
                options={[
                  { value: 'double', label: 'Double  "' },
                  { value: 'single', label: "Single  '" },
                ]}
              />
            </Field>
          </div>
        </PopoverContent>
      </Popover>
      <ToolbarField label="Indent">
        <Select
          aria-label="Indentation"
          value={String(opts.indent)}
          onValueChange={(v) => set({ indent: v === '\t' ? '\t' : Number(v) })}
          options={[
            { value: '2', label: '2 spaces' },
            { value: '4', label: '4 spaces' },
            { value: '\t', label: 'Tab' },
            { value: '0', label: 'Minified' },
          ]}
        />
      </ToolbarField>
      <ToolbarSpacer />
      <RulesPopover />
      {!isMobile && (
        <Button variant="ghost" size="sm" onClick={() => setShowColumns(!showColumns)} aria-pressed={showColumns} className={cn(showColumns && 'text-fg')}>
          <Rows3 /> Columns
        </Button>
      )}
    </Toolbar>
  )

  const inputPane = (
    <InputEditorPane
      ref={inputRef}
      title="CSV"
      value={input}
      onChange={setInput}
      sample={SAMPLE}
      accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
      markers={markers}
      path="csv-to-json-input"
      placeholder="Paste CSV or TSV, or drop a .csv file…"
      wordWrap={false}
    />
  )

  const outputPane = (
    <Pane aria-label="JSON output">
      <PaneHeader
        title="JSON"
        meta={
          <span className="flex items-center gap-2">
            {stale && debounced && <Loader2 className="size-3 animate-spin" aria-label="Updating" />}
            {result && `${formatNumber(result.rowCount)} rows`}
          </span>
        }
        actions={
          <>
            <Segmented
              size="xs"
              aria-label="Output view"
              value={view}
              onValueChange={setView}
              options={[
                { value: 'json', label: 'JSON' },
                { value: 'table', label: 'Table' },
              ]}
            />
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <CopyButton value={() => json} label="Copy JSON" disabled={!json} />
            <DownloadButton getContent={() => json} filename="data.json" mime="application/json" label="Download JSON" disabled={!json} />
          </>
        }
      />
      {task.error && <ErrorDisplay error={task.error.message} />}
      {result && <IssuesBanner issues={result.issues} onLocate={(l, c) => inputRef.current?.revealPosition(l, c)} />}
      <PaneBody className="flex flex-col">
        {!input.trim() ? (
          <EmptyState
            icon={<FileJson />}
            title="Paste CSV to convert it to JSON"
            description="The delimiter is detected automatically. Numbers, booleans and empty fields are typed; ZIP codes and long IDs stay text."
            actions={
              <Button size="sm" onClick={() => (inputRef.current?.editor ? inputRef.current.replaceAll(SAMPLE) : setInput(SAMPLE))}>
                Load sample
              </Button>
            }
          />
        ) : view === 'table' ? (
          <DataGrid
            ariaLabel="Parsed CSV"
            columns={gridColumns}
            rowCount={rowCount}
            getCell={(r, c) => result?.rows[dataStart + r]?.[included[c].i] ?? ''}
            rowLabel={(r) => result?.recordNumbers[dataStart + r] ?? r + 1}
            maxRowLabel={result?.recordNumbers[result.recordNumbers.length - 1]}
            onResize={onResize}
          />
        ) : (
          <CodeEditor value={json} readOnly language="json" ariaLabel="JSON output (read-only)" path="csv-to-json-output" />
        )}
      </PaneBody>
    </Pane>
  )

  const columnsPanel = (
    <ColumnsPanel
      items={columnItems}
      onToggle={(key, inc) => set({ exclude: inc ? opts.exclude.filter((k) => k !== key) : [...opts.exclude, key] })}
      onRename={(key, name) => {
        const rename = { ...opts.rename }
        if (name) rename[key] = name
        else delete rename[key]
        set({ rename })
      }}
      onAll={(inc) => set({ exclude: inc ? [] : columnItems.map((i) => i.key) })}
      onReset={() => set({ exclude: [], rename: {} })}
    />
  )

  const status = (
    <StatusBar>
      <StatusItem label="Rows">{result ? formatNumber(result.rowCount) : '—'}</StatusItem>
      <StatusItem label="Columns">{result ? `${included.length}${included.length !== result.columns.length ? ` of ${result.columns.length}` : ''}` : '—'}</StatusItem>
      <StatusItem label="JSON">{json ? formatBytes(jsonBytes) : '—'}</StatusItem>
      {result && result.issues.length > 0 && (
        <StatusItem tone={hasError ? 'danger' : 'mod'}>
          {result.issues.length} {result.issues.length === 1 ? 'issue' : 'issues'}
        </StatusItem>
      )}
      <StatusSpacer />
      {result && <StatusItem label="Delimiter">{`${delimiterLabel(result.delimiter)}${result.delimiterDetected ? ' (detected)' : ''}`}</StatusItem>}
      {result && <StatusItem label="Line endings">{linebreakLabel(result.linebreak)}</StatusItem>}
      {task.running && (
        <Button size="xs" variant="ghost" onClick={task.cancel}>
          <X /> Cancel
        </Button>
      )}
      {task.duration != null && result && <StatusItem label="Took">{formatDuration(task.duration)}</StatusItem>}
    </StatusBar>
  )

  if (isMobile) {
    return (
      <>
        {toolbar}
        <div className="flex shrink-0 items-center border-b border-border bg-bg px-3 py-1.5">
          <Segmented
            aria-label="Visible pane"
            value={mobileTab}
            onValueChange={setMobileTab}
            className="w-full [&>*]:flex-1 [&>*]:justify-center"
            options={[
              { value: 'input', label: 'CSV' },
              { value: 'output', label: 'JSON' },
              { value: 'columns', label: 'Columns' },
            ]}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{mobileTab === 'input' ? inputPane : mobileTab === 'output' ? outputPane : columnsPanel}</div>
        {status}
      </>
    )
  }

  return (
    <>
      {toolbar}
      <div className="flex min-h-0 flex-1">
        <SplitPane id="csv-to-json" initial={0.5}>
          {inputPane}
          {outputPane}
        </SplitPane>
        {showColumns && <div className="flex w-[264px] shrink-0 flex-col border-l border-border xl:w-[288px]">{columnsPanel}</div>}
      </div>
      {status}
    </>
  )
}

function RulesPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Info /> Rules
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] text-[13px] leading-[19px] text-muted">
        <p className="mb-2 text-sm font-medium text-fg">How values are typed</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-4">
          <li>
            <span className="text-fg">Numbers</span> must be plain JSON numbers: <code className="mono">-12</code>, <code className="mono">3.5</code>, <code className="mono">1e6</code>. <code className="mono">+5</code>, <code className="mono">.5</code>, <code className="mono">1,000</code>, <code className="mono">0x1F</code> stay text.
          </li>
          <li>
            <span className="text-fg">Leading zeros</span> keep a value as text: ZIP <code className="mono">02134</code>, codes like <code className="mono">007</code>.
          </li>
          <li>
            <span className="text-fg">Long digit strings</span> (more than 15 digits) stay text so IDs and card numbers are never rounded. Decimals that would lose precision also stay text.
          </li>
          <li>
            <span className="text-fg">Booleans:</span> <code className="mono">true</code>/<code className="mono">false</code> in any case. <code className="mono">yes</code>/<code className="mono">no</code> stay text.
          </li>
          <li>
            <span className="text-fg">Empty fields</span> become <code className="mono">null</code> (or <code className="mono">""</code> with the option off). Missing fields in short rows count as empty.
          </li>
          <li>
            <span className="text-fg">Headers:</span> blanks become <code className="mono">column_N</code>, duplicates get <code className="mono">_2</code>. Extra fields in long rows are kept under new <code className="mono">column_N</code> keys.
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  )
}
