import { useDeferredValue, useEffect, useMemo } from 'react'
import { ChevronDown, Download, Info, Loader2, Play, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  generateDataset,
  MAX_ROWS,
  OUTPUT_FORMATS,
  PRESETS,
  validateSchema,
  type DatasetResult,
  type Field,
  type FormatOptions,
  type OutputFormat,
  type SqlDialect,
} from '@/engines/generators/randomData'
import { randomSeed } from '@/engines/generators/random'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { CodeEditor } from '@/components/editors/CodeEditor'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Kbd } from '@/components/ui/kbd'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CopyButton } from '@/components/common/CopyButton'
import { downloadText } from '@/utils/download'
import { formatBytes, formatDuration, formatNumber, utf8Length } from '@/utils/format'
import { modKey } from '@/utils/platform'
import { NumberInput } from '../_shared/NumberInput'
import { useRegenerateShortcut } from '../_shared/useShortcut'
import { SchemaEditor } from './SchemaEditor'
import DataWorker from './worker.ts?worker'
import type { Tasks } from './worker'

/** Up to this many rows everything is generated on the main thread and shown in full. */
const SYNC_LIMIT = 2000
/** Larger datasets show this many rows in the editor; copy/download produce all rows (worker). */
const PREVIEW_ROWS = 200

const DEFAULT_FORMAT: FormatOptions = { format: 'json', tableName: 'users', dialect: 'postgres', batchSize: 100 }

const DIALECTS: { value: SqlDialect; label: string }[] = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'sqlserver', label: 'SQL Server' },
]

function countFields(fields: Field[]): number {
  return fields.reduce((n, f) => n + (f.type === 'object' ? (f.children?.length ?? 0) : 1), 0)
}

export default function RandomData() {
  const [fields, setFields] = usePersistentState<Field[]>('fields', () => PRESETS[0].build())
  const [count, setCount] = usePersistentState('count', 50)
  const [fmt, setFmt] = usePersistentState<FormatOptions>('format', DEFAULT_FORMAT)
  const [seed, setSeed, restored] = usePersistentState('seed', '')
  const patchFmt = (p: Partial<FormatOptions>) => setFmt({ ...fmt, ...p })

  useEffect(() => {
    if (restored && !seed) setSeed(randomSeed())
  }, [restored, seed, setSeed])

  const worker = useWorker<Tasks>(() => new DataWorker({ name: 'devtoolkit-random-data' }))
  const full = useTask<{ key: string; result: DatasetResult }>()

  const issues = useMemo(() => validateSchema(fields), [fields])
  const req = useDeferredValue({ fields, count, seed, fmt })
  const reqKey = JSON.stringify(req)
  const large = req.count > SYNC_LIMIT

  const sync = useMemo(() => {
    if (issues.length || !req.seed) return null
    const t = performance.now()
    try {
      const n = large ? PREVIEW_ROWS : req.count
      const result = generateDataset({ fields: req.fields, count: n, seed: req.seed, options: req.fmt, previewRows: n })
      return { result, ms: performance.now() - t, error: null }
    } catch (e) {
      return { result: null, ms: 0, error: e instanceof Error ? e.message : String(e) }
    }
  }, [req, issues.length, large])

  const fullCurrent = full.result?.key === reqKey ? full.result.result : null

  const runFull = async (): Promise<DatasetResult | undefined> => {
    const key = reqKey
    const r = await full.run(async (signal) => ({ key, result: await worker.run('generateDataset', { fields: req.fields, count: req.count, seed: req.seed, options: req.fmt, previewRows: PREVIEW_ROWS }, signal) }))
    return r?.result
  }

  /** The complete output — generated in the worker on demand for large datasets. */
  const getFull = async (): Promise<string> => {
    if (!large) return sync?.result?.output ?? ''
    if (fullCurrent) return fullCurrent.output
    const t = toast.loading(`Generating ${formatNumber(req.count)} rows…`)
    const r = await runFull()
    toast.dismiss(t)
    if (!r) throw new Error('Generation was cancelled')
    return r.output
  }

  const fmtMeta = OUTPUT_FORMATS.find((f) => f.value === fmt.format)!
  const filename = `${(fmt.tableName || 'data').replace(/[^\w.-]+/g, '_')}.${fmtMeta.ext}`
  const download = async () => {
    try {
      downloadText(await getFull(), filename, `${fmtMeta.mime};charset=utf-8`)
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e))
    }
  }

  const regenerate = () => setSeed(randomSeed())
  useRegenerateShortcut(regenerate)

  const preview = sync?.result?.output ?? ''
  const error = issues[0]?.message ?? sync?.error ?? null
  const outputSize = large ? (fullCurrent ? utf8Length(fullCurrent.output) : null) : utf8Length(preview)

  const loadPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!
    setFields(p.build())
    patchFmt({ tableName: p.table })
  }

  const schemaPane = (
    <Pane aria-label="Schema">
      <PaneHeader
        title="Schema"
        meta={`${countFields(fields)} fields`}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="ghost">
                Presets <ChevronDown className="text-subtle" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Replace schema with</DropdownMenuLabel>
              {PRESETS.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => loadPreset(p.id)}>
                  {p.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SchemaEditor fields={fields} onChange={setFields} issues={issues} />
      </div>
    </Pane>
  )

  const largeBanner = large && !error && (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-surface px-3 py-1.5 text-sm">
      <span className="min-w-0 flex-1 text-muted">
        Showing the first {PREVIEW_ROWS} of {formatNumber(req.count)} rows.{' '}
        {fullCurrent ? <span className="text-fg">All rows ready — {formatBytes(outputSize ?? 0)}.</span> : 'Copy and Download produce every row.'}
      </span>
      {full.running ? (
        <>
          <span className="flex items-center gap-1.5 text-muted">
            <Loader2 className="size-3.5 animate-spin" /> Generating…
          </span>
          <Button size="xs" variant="ghost" onClick={full.cancel}>
            <X /> Cancel
          </Button>
        </>
      ) : (
        !fullCurrent && (
          <Button size="xs" onClick={() => void runFull()}>
            <Play /> Generate all {formatNumber(req.count)} rows
          </Button>
        )
      )}
    </div>
  )

  const outputPane = (
    <Pane aria-label="Output">
      <PaneHeader
        title="Output"
        actions={
          <>
            <CopyButton value={getFull} label="Copy all rows" disabled={!!error || !preview} />
            <IconButton label={`Download ${filename}`} icon={<Download />} onClick={download} disabled={!!error || !preview} />
          </>
        }
      >
        <Select aria-label="Output format" value={fmt.format} onValueChange={(format: OutputFormat) => patchFmt({ format })} options={OUTPUT_FORMATS.map(({ value, label }) => ({ value, label }))} className="ml-1" />
        {(fmt.format === 'sql' || fmt.format === 'typescript') && (
          <Input aria-label={fmt.format === 'sql' ? 'Table name' : 'Type name source'} title={fmt.format === 'sql' ? 'Table name' : 'Used to name the TypeScript interface'} className="mono h-7 w-28 text-[12.5px]" value={fmt.tableName} onChange={(e) => patchFmt({ tableName: e.target.value })} placeholder="table" />
        )}
        {fmt.format === 'sql' && <Select aria-label="SQL dialect" value={fmt.dialect} onValueChange={(dialect: SqlDialect) => patchFmt({ dialect })} options={DIALECTS} className="hidden xl:inline-flex" />}
      </PaneHeader>
      <div className="flex shrink-0 items-start gap-2 border-b border-border bg-mod-bg/50 px-3 py-1.5 text-xs text-muted" role="note">
        <Info className="mt-px size-3.5 shrink-0 text-mod" />
        <span>
          <span className="font-medium text-fg">Synthetic sample data.</span> Names, emails (example.com/.org/.net), phone numbers (555-01xx), addresses and IPs (documentation ranges) are fictional.
        </span>
      </div>
      {error ? <ErrorDisplay error={error} title="Schema" /> : largeBanner}
      {full.error && <ErrorDisplay error={full.error.message} />}
      <div className="relative min-h-0 flex-1">
        <CodeEditor value={error ? '' : preview} readOnly language={fmtMeta.language} ariaLabel="Generated data (read-only)" path={`random-data.${fmtMeta.ext}`} />
        {error && (
          <div className="absolute inset-0 bg-workspace">
            <EmptyState compact title="Fix the schema to generate data" description="The highlighted field needs attention — output updates as soon as the schema is valid." />
          </div>
        )}
      </div>
    </Pane>
  )

  return (
    <>
      <Toolbar>
        <ToolbarField label="Rows">
          <NumberInput aria-label="Rows" value={count} onChange={setCount} min={1} max={MAX_ROWS} className="w-24" />
        </ToolbarField>
        <ToolbarField label="Seed">
          <Input aria-label="Seed" className="mono h-7 w-28 text-[12.5px]" value={seed} onChange={(e) => setSeed(e.target.value)} />
        </ToolbarField>
        <ToolbarSeparator />
        <Button size="sm" variant="primary" onClick={regenerate}>
          <RefreshCw /> Regenerate
          <span className="ml-1 hidden items-center gap-0.5 opacity-80 sm:flex">
            <Kbd className="border-white/25 bg-white/10 text-current">{modKey}</Kbd>
            <Kbd className="border-white/25 bg-white/10 text-current">↵</Kbd>
          </span>
        </Button>
        <ToolbarSpacer />
        <Badge tone="mod" title="All values are randomly generated and fictional.">
          Synthetic data
        </Badge>
      </Toolbar>
      <div className="flex min-h-0 flex-1 flex-col">
        <SplitPane id="random-data" initial={0.44} min={300} mobileTabs={['Schema', 'Output']}>
          {schemaPane}
          {outputPane}
        </SplitPane>
      </div>
      <StatusBar>
        <StatusItem label="Rows">{formatNumber(count)}</StatusItem>
        <StatusItem label="Fields">{countFields(fields)}</StatusItem>
        <StatusItem label="Format">{fmtMeta.label}</StatusItem>
        {outputSize != null && !error && <StatusItem label="Size">{formatBytes(outputSize)}</StatusItem>}
        {large ? full.duration != null && fullCurrent && <StatusItem label="Generated in">{formatDuration(full.duration)}</StatusItem> : sync && !error && <StatusItem label="Generated in">{formatDuration(sync.ms)}</StatusItem>}
        <StatusSpacer />
        <StatusItem label="Seed">
          <span className="mono">{seed || '—'}</span>
        </StatusItem>
      </StatusBar>
    </>
  )
}
