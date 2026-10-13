import { useEffect, useMemo, useRef, useState } from 'react'
import { Braces, Loader2, Rows3, Settings2, Table2, X } from 'lucide-react'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneBody, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { CodeEditor, type CodeEditorHandle, type EditorMarker } from '@/components/editors/CodeEditor'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CopyButton } from '@/components/common/CopyButton'
import { DownloadButton } from '@/components/common/DownloadButton'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput, useSendToTool } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useTask } from '@/hooks/useTask'
import { useWorker } from '@/hooks/useWorker'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { BOM, delimiterLabel } from '@/engines/data/csv'
import { DEFAULT_JSON_TO_CSV, formatPath, jsonToCsv, type JsonToCsvOptions, type JsonToCsvOutcome, type PathSegment, type ValueKind } from '@/engines/data/json-to-csv'
import { DataGrid, estimateWidth, type GridColumn } from '../csv-viewer/shared/DataGrid'
import { ColumnsPanel, type ColumnItem } from '../csv-viewer/shared/ColumnsPanel'
import { DelimiterField } from '../csv-viewer/shared/DelimiterField'
import { useColumnWidths } from '../csv-viewer/shared/useColumnWidths'
import { cn } from '@/utils/cn'
import { formatBytes, formatDuration, formatNumber, utf8Length } from '@/utils/format'
import ToolWorker from './worker.ts?worker'
import type { Tasks } from './worker'

/** Inputs larger than this are converted in a worker. */
const WORKER_THRESHOLD = 150_000

const SAMPLE = `{
  "data": {
    "orders": [
      {
        "id": "ord_8f2a1c",
        "createdAt": "2024-03-18T09:24:11Z",
        "status": "shipped",
        "customer": { "id": 10293, "name": "Amelia Hart", "email": "amelia.hart@example.com", "address": { "city": "Portland", "zip": "04101" } },
        "items": [{ "sku": "KB-104", "qty": 1 }, { "sku": "MS-220", "qty": 2 }],
        "tags": ["priority", "gift"],
        "total": 129.5,
        "coupon": null,
        "trackingId": 9400111202555842761234,
        "note": "Leave at back door, \\"blue gate\\""
      },
      {
        "id": "ord_8f2a1d",
        "createdAt": "2024-03-18T11:02:45Z",
        "status": "processing",
        "customer": { "id": 10377, "name": "Kenji Watanabe", "email": "kenji.w@example.jp", "address": { "city": "Osaka", "zip": "530-0001" } },
        "items": [{ "sku": "HD-310", "qty": 1 }],
        "tags": [],
        "total": 54,
        "coupon": "SPRING10",
        "trackingId": null,
        "note": ""
      },
      {
        "id": "ord_8f2a1e",
        "createdAt": "2024-03-19T16:40:00Z",
        "status": "cancelled",
        "customer": { "id": 10421, "name": "Lucía Fernández", "email": "lucia.f@example.es", "address": { "city": "Sevilla", "zip": "41001" } },
        "items": [{ "sku": "KB-104", "qty": 3 }, { "sku": "CB-002", "qty": 1 }],
        "tags": ["refund"],
        "total": 297,
        "coupon": null,
        "trackingId": null,
        "note": "Customer asked to cancel:\\nwrong colour"
      }
    ]
  },
  "meta": { "page": 1, "pageSize": 25, "total": 3 }
}`

const KIND_LABEL: Record<ValueKind, string> = { string: 'str', number: 'num', boolean: 'bool', null: 'null', object: 'obj', array: 'arr' }

function kindLabel(kinds: ValueKind[]) {
  const real = kinds.filter((k) => k !== 'null')
  if (!real.length) return kinds.length ? 'null' : ''
  return real.length === 1 ? KIND_LABEL[real[0]] : 'mixed'
}

type Stored = Partial<JsonToCsvOptions> & { bom?: boolean }

export default function JsonToCsv() {
  const [input, setInput] = usePersistentState('input', '')
  const [stored, setStored] = usePersistentState<Stored>('options', {})
  const [view, setView] = usePersistentState<'table' | 'text'>('view', 'table')
  const [showColumns, setShowColumns] = usePersistentState('showColumns', true)
  const [mobileTab, setMobileTab] = useState<'input' | 'output' | 'columns'>('input')
  const isMobile = useIsMobile()
  const inputRef = useRef<CodeEditorHandle>(null)
  const send = useSendToTool()
  useIncomingInput(setInput)

  const opts: JsonToCsvOptions = useMemo(() => {
    const { bom: _bom, ...rest } = stored
    void _bom
    return { ...DEFAULT_JSON_TO_CSV, ...rest, columns: { ...DEFAULT_JSON_TO_CSV.columns, ...rest.columns } }
  }, [stored])
  const bom = !!stored.bom
  const set = (patch: Stored) => setStored((s) => ({ ...s, ...patch }))
  const setColumns = (fn: (c: JsonToCsvOptions['columns']) => JsonToCsvOptions['columns']) => setStored((s) => ({ ...s, columns: fn({ ...DEFAULT_JSON_TO_CSV.columns, ...s.columns }) }))

  const debounced = useDebouncedValue(input, adaptiveDelay(input.length))
  const worker = useWorker<Tasks>(() => new ToolWorker({ name: 'json-to-csv' }))
  const task = useTask<JsonToCsvOutcome>()
  const optsKey = JSON.stringify(opts)

  useEffect(() => {
    if (!debounced.trim()) {
      task.reset()
      return
    }
    const text = debounced
    const o = opts
    void task.run((signal) => (text.length > WORKER_THRESHOLD ? worker.run('convert', { text, opts: o }, signal) : jsonToCsv(text, o)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, optsKey])

  const result = debounced.trim() ? task.result : undefined
  const ok = result?.ok ? result : null
  const error = task.error ? { message: task.error.message } : result && !result.ok ? result.error : null
  const stale = input !== debounced || task.running

  const markers: EditorMarker[] | undefined = error && 'line' in error && error.line ? [{ message: error.message, line: error.line, column: error.column ?? 1 }] : undefined

  // Grid
  const headers = ok?.table.headers ?? []
  const keys = ok?.table.keys ?? []
  const defaults = useMemo(() => {
    if (!ok) return []
    const sample = ok.table.rows.slice(0, 200)
    return ok.table.headers.map((h, c) => estimateWidth(h, sample.map((r) => r[c])))
  }, [ok])
  const [widths, onResize] = useColumnWidths(keys, defaults)
  const gridColumns: GridColumn[] = useMemo(() => {
    const info = new Map(ok?.columns.map((c) => [c.key, c]))
    return headers.map((name, i) => {
      const kinds = info.get(keys[i])?.kinds ?? []
      return { name, width: widths[i] ?? 120, numeric: kinds.length > 0 && kinds.every((k) => k === 'number' || k === 'null') }
    })
  }, [headers, keys, widths, ok])

  const csv = ok?.csv ?? ''
  const csvBytes = useMemo(() => (csv.length < 5_000_000 ? utf8Length(csv) : csv.length), [csv])

  // Record source picker
  const pathOptions = useMemo(() => {
    if (!ok) return []
    const opts = ok.candidates.map((c) => ({ value: c.label, label: `${c.label}`, description: `${formatNumber(c.length)} ${c.objectShare > 0.5 ? 'objects' : 'items'}`, path: c.path }))
    if (!ok.candidates.some((c) => c.path.length === 0)) opts.push({ value: '$', label: '$', description: 'Whole document as one row', path: [] })
    return opts
  }, [ok])
  const currentPath = ok ? formatPath(ok.path) : '$'

  const columnItems: ColumnItem[] = useMemo(
    () => (ok?.columns ?? []).map((c) => ({ key: c.key, rename: opts.columns.rename[c.key] ?? '', included: c.included, kind: kindLabel(c.kinds), detail: `${c.present}` })),
    [ok, opts.columns.rename],
  )

  const download = () => (bom ? BOM + csv : csv)

  const flattenActive = !opts.flatten || opts.separator !== '.' || opts.maxDepth !== 0 || opts.joinWith !== '; '
  const formatActive = opts.quote !== 'minimal' || !opts.header || opts.lineEnding !== 'lf' || bom || opts.nullText !== '' || opts.missingText !== '' || opts.escapeFormulas

  const toolbar = (
    <Toolbar>
      {pathOptions.length > 1 && (
        <>
          <ToolbarField label="Records">
            <Select
              aria-label="Record array"
              value={currentPath}
              onValueChange={(v) => {
                const p = pathOptions.find((o) => o.value === v)
                if (p) set({ path: p.path as PathSegment[] })
              }}
              options={pathOptions.map(({ value, label, description }) => ({ value, label: <span className="mono text-[12px]">{label}</span>, description }))}
              className="max-w-56"
            />
          </ToolbarField>
          <ToolbarSeparator />
        </>
      )}
      <DelimiterField value={opts.delimiter} onChange={(delimiter) => set({ delimiter })} />
      <ToolbarField label="Arrays">
        <Select
          aria-label="Array handling"
          value={opts.arrays}
          onValueChange={(arrays) => set({ arrays })}
          options={[
            { value: 'join', label: 'Join values', description: `["a","b"] → a${opts.joinWith}b` },
            { value: 'json', label: 'JSON text', description: '["a","b"] → ["a","b"]' },
            { value: 'expand', label: 'Expand to columns', description: 'tags[0], tags[1], items[0].sku…' },
          ]}
        />
      </ToolbarField>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn(flattenActive && 'text-accent-text')}>
            <Braces /> Nesting
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="flex flex-col gap-3.5">
            <Checkbox checked={opts.flatten} onCheckedChange={(v) => set({ flatten: v === true })} label="Flatten nested objects" description={`{"user":{"name":…}} → user${opts.separator || '.'}name. Off: objects are written as JSON text.`} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Key separator">
                <Input value={opts.separator} onChange={(e) => set({ separator: e.target.value })} disabled={!opts.flatten} className="mono" aria-invalid={opts.flatten && !opts.separator} />
              </Field>
              <Field label="Max depth">
                <Select
                  aria-label="Max flatten depth"
                  size="md"
                  disabled={!opts.flatten}
                  value={String(opts.maxDepth)}
                  onValueChange={(v) => set({ maxDepth: Number(v) })}
                  options={[{ value: '0', label: 'Unlimited' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} level${n > 1 ? 's' : ''}` }))]}
                />
              </Field>
            </div>
            <p className="-mt-1.5 text-2xs text-subtle">Values nested deeper than the limit are written as JSON text.</p>
            <Field label="Join arrays with" hint="Used by the “Join values” array mode.">
              <Input value={opts.joinWith} onChange={(e) => set({ joinWith: e.target.value })} className="mono" disabled={opts.arrays !== 'join'} />
            </Field>
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn(formatActive && 'text-accent-text')}>
            <Settings2 /> Format
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="flex flex-col gap-3.5">
            <Field label="Quoting">
              <Segmented
                aria-label="Quoting"
                value={opts.quote}
                onValueChange={(quote) => set({ quote })}
                options={[
                  { value: 'minimal', label: 'When needed', tooltip: 'RFC 4180: quote fields containing the delimiter, quotes, line breaks or edge spaces' },
                  { value: 'all', label: 'Every field' },
                ]}
              />
            </Field>
            <Field label="Line endings">
              <Segmented
                aria-label="Line endings"
                value={opts.lineEnding}
                onValueChange={(lineEnding) => set({ lineEnding })}
                options={[
                  { value: 'lf', label: 'LF (Unix)' },
                  { value: 'crlf', label: 'CRLF (Windows, RFC 4180)' },
                ]}
              />
            </Field>
            <Checkbox checked={opts.header} onCheckedChange={(v) => set({ header: v === true })} label="Header row" />
            <Checkbox checked={bom} onCheckedChange={(v) => set({ bom: v === true })} label="UTF-8 BOM for Excel" description="Added to downloaded files so Excel shows accents and emoji correctly." />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Write null as">
                <Input value={opts.nullText} onChange={(e) => set({ nullText: e.target.value })} placeholder="(empty)" className="mono" />
              </Field>
              <Field label="Missing key as">
                <Input value={opts.missingText} onChange={(e) => set({ missingText: e.target.value })} placeholder="(empty)" className="mono" />
              </Field>
            </div>
            <Checkbox
              checked={opts.escapeFormulas}
              onCheckedChange={(v) => set({ escapeFormulas: v === true })}
              label="Escape spreadsheet formulas"
              description="Prefix ' to text starting with = + - @ so Excel/Sheets don't run it."
            />
          </div>
        </PopoverContent>
      </Popover>
      <ToolbarSpacer />
      {!isMobile && (
        <Button variant="ghost" size="sm" onClick={() => setShowColumns(!showColumns)} aria-pressed={showColumns} className={cn(showColumns && 'text-fg')}>
          <Rows3 /> Columns
        </Button>
      )}
    </Toolbar>
  )

  const banner = (
    <>
      {error && <ErrorDisplay error={error} onLocate={(l, c) => inputRef.current?.revealPosition(l, c)} title="Invalid JSON" />}
      {!error && ok?.warnings.map((w, i) => <ErrorDisplay key={i} severity="warning" error={w} />)}
    </>
  )

  const inputPane = (
    <InputEditorPane
      ref={inputRef}
      title="JSON"
      value={input}
      onChange={setInput}
      language="json"
      sample={SAMPLE}
      accept=".json,application/json,.txt"
      markers={markers}
      path="json-to-csv-input"
      placeholder="Paste a JSON array of objects, or an API response that contains one…"
    />
  )

  const outputPane = (
    <Pane aria-label="CSV output">
      <PaneHeader
        title="CSV"
        meta={
          <span className="flex items-center gap-2">
            {stale && debounced && <Loader2 className="size-3 animate-spin" aria-label="Updating" />}
            {ok && `${formatNumber(ok.table.rows.length)} rows × ${ok.table.keys.length} columns`}
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
                { value: 'table', label: 'Table' },
                { value: 'text', label: 'Text' },
              ]}
            />
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <IconButton label="Open in CSV Viewer" icon={<Table2 />} disabled={!csv} onClick={() => send('/json/csv-viewer', csv)} />
            <CopyButton value={() => csv} label="Copy CSV" disabled={!csv} />
            <DownloadButton getContent={download} filename="data.csv" mime="text/csv;charset=utf-8" label={bom ? 'Download CSV (with BOM)' : 'Download CSV'} disabled={!csv} />
          </>
        }
      />
      {banner}
      <PaneBody className="flex flex-col">
        {!input.trim() ? (
          <EmptyState
            icon={<Table2 />}
            title="Paste JSON to turn it into CSV"
            description="An array of objects becomes one row per object. Nested objects are flattened to dot keys; if the array is wrapped in an API response, pick it under Records."
            actions={
              <Button size="sm" onClick={() => (inputRef.current?.editor ? inputRef.current.replaceAll(SAMPLE) : setInput(SAMPLE))}>
                Load sample
              </Button>
            }
          />
        ) : !ok ? null : view === 'table' ? (
          <DataGrid
            ariaLabel="CSV preview"
            columns={gridColumns}
            rowCount={ok.table.rows.length}
            getCell={(r, c) => ok.table.rows[r]?.[c]}
            onResize={onResize}
            empty={!error ? <EmptyState compact title={ok.table.keys.length ? 'No records' : 'No columns'} description={ok.table.keys.length ? 'The selected array is empty.' : 'Every column is excluded, or the records are empty.'} /> : null}
          />
        ) : (
          <CodeEditor value={csv} readOnly ariaLabel="CSV text (read-only)" path="json-to-csv-output" wordWrap={false} />
        )}
      </PaneBody>
    </Pane>
  )

  const columnsPanel = (
    <ColumnsPanel
      items={columnItems}
      onToggle={(key, included) => setColumns((c) => ({ ...c, exclude: included ? c.exclude.filter((k) => k !== key) : [...c.exclude, key] }))}
      onRename={(key, name) =>
        setColumns((c) => {
          const rename = { ...c.rename }
          if (name) rename[key] = name
          else delete rename[key]
          return { ...c, rename }
        })
      }
      onAll={(included) => setColumns((c) => ({ ...c, exclude: included ? [] : columnItems.map((i) => i.key) }))}
      onReset={() => setColumns(() => ({ exclude: [], rename: {} }))}
      extra={<Checkbox checked={opts.sortColumns} onCheckedChange={(v) => set({ sortColumns: v === true })} label="Sort columns A → Z" description="Otherwise: order of first appearance" />}
    />
  )

  const status = (
    <StatusBar>
      <StatusItem label="Records">{ok ? formatNumber(ok.recordCount) : '—'}</StatusItem>
      <StatusItem label="Columns">{ok ? `${ok.table.keys.length}${ok.columns.length !== ok.table.keys.length ? ` of ${ok.columns.length}` : ''}` : '—'}</StatusItem>
      <StatusItem label="CSV">{csv ? formatBytes(csvBytes + (bom ? 3 : 0)) : '—'}</StatusItem>
      {ok && ok.candidates.length > 0 && <StatusItem label="Source"><span className="mono">{currentPath}</span></StatusItem>}
      <StatusSpacer />
      <StatusItem label="Delimiter">{delimiterLabel(opts.delimiter)}</StatusItem>
      <StatusItem label="Line endings">{opts.lineEnding.toUpperCase()}</StatusItem>
      {bom && <StatusItem>BOM</StatusItem>}
      {task.running && (
        <Button size="xs" variant="ghost" onClick={task.cancel}>
          <X /> Cancel
        </Button>
      )}
      {task.duration != null && ok && <StatusItem label="Took">{formatDuration(task.duration)}</StatusItem>}
      {error && <StatusItem tone="danger">Invalid JSON</StatusItem>}
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
              { value: 'input', label: 'JSON' },
              { value: 'output', label: 'CSV' },
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
        <SplitPane id="json-to-csv" initial={0.42}>
          {inputPane}
          {outputPane}
        </SplitPane>
        {showColumns && <div className="flex w-[264px] shrink-0 flex-col border-l border-border xl:w-[288px]">{columnsPanel}</div>}
      </div>
      {status}
    </>
  )
}
