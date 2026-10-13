import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Loader2, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  DEFAULT_FREQUENCY_OPTIONS,
  frequencyToCsv,
  frequencyToJson,
  frequencyToTsv,
  sortRows,
  wordFrequency,
  type FrequencyOptions,
  type FrequencyResult,
  type FrequencyRow,
  type FrequencySortKey,
} from '@/engines/text/frequency'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Pane, PaneBody, PaneHeader } from '@/components/tools/Pane'
import { Toolbar, ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CopyButton } from '@/components/common/CopyButton'
import { downloadText } from '@/utils/download'
import { cn } from '@/utils/cn'
import { formatDuration, formatNumber, pluralize } from '@/utils/format'
import FrequencyWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const WORKER_THRESHOLD = 100_000

const SAMPLE = `Incident review: checkout latency spike

On Tuesday the checkout service slowed down for 42 minutes. The checkout service depends on the pricing service, and the pricing service started timing out after a cache deploy. Requests to the pricing service retried three times, so every slow request became four slow requests.

The cache deploy changed the cache key format. Old cache entries were no longer found, the cache hit rate fell from 96% to 11%, and the database absorbed the load. Database CPU stayed above 90% until the cache warmed up again.

What went well: alerts fired within two minutes, and the on-call engineer rolled back the cache deploy quickly. What went badly: retries amplified the outage, and the checkout service had no circuit breaker for the pricing service.

Action items: add a circuit breaker to the checkout service; cap retries for the pricing service; version the cache key format; load-test cache deploys before release.`

const TOP_OPTIONS = [
  { value: '50', label: 'Top 50' },
  { value: '100', label: 'Top 100' },
  { value: '500', label: 'Top 500' },
  { value: '1000', label: 'Top 1,000' },
  { value: '0', label: 'All terms' },
]

const ROW_H = 28
const COLS = 'grid-cols-[36px_minmax(0,1fr)_56px_56px] @md:grid-cols-[52px_minmax(0,1fr)_72px_64px_minmax(48px,120px)]'

function SortHeader({ label, k, sort, onSort, className }: { label: string; k: FrequencySortKey; sort: { key: FrequencySortKey; dir: 'asc' | 'desc' }; onSort: (k: FrequencySortKey) => void; className?: string }) {
  const active = sort.key === k
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-label={`Sort by ${label}`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('eyebrow inline-flex items-center gap-1 rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-ring', active && 'text-fg', className)}
    >
      {label}
      {active && (sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
    </button>
  )
}

function FrequencyTable({ rows, maxCount, dim }: { rows: FrequencyRow[]; maxCount: number; dim: boolean }) {
  const parent = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => ROW_H, overscan: 16 })
  return (
    <div ref={parent} className={cn('absolute inset-0 overflow-auto', dim && 'opacity-60')} role="table" aria-label="Term frequency" aria-rowcount={rows.length}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((it) => {
          const r = rows[it.index]
          return (
            <div key={it.key} role="row" className={cn('absolute inset-x-0 grid items-center gap-3 border-b border-border/50 px-3 text-[13px] hover:bg-surface-2/50', COLS)} style={{ top: it.start, height: ROW_H }}>
              <span className="justify-self-end text-2xs text-subtle tabular">{r.rank}</span>
              <span className="mono truncate text-[12.5px]" title={r.term}>
                {r.term}
              </span>
              <span className="justify-self-end tabular">{formatNumber(r.count)}</span>
              <span className="justify-self-end text-xs text-muted tabular">{(r.share * 100).toFixed(r.share >= 0.1 ? 1 : 2)}%</span>
              <span className="hidden h-1.5 overflow-hidden rounded-sm bg-surface-2 @md:block">
                <span className="block h-full rounded-sm bg-accent/70" style={{ width: `${Math.max(2, (r.count / maxCount) * 100)}%` }} />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function WordFrequency() {
  const [input, setInput] = usePersistentState('input', '')
  const [stored, setOptions] = usePersistentState<FrequencyOptions>('options', { ...DEFAULT_FREQUENCY_OPTIONS, topN: 100 })
  const options = useMemo(() => ({ ...DEFAULT_FREQUENCY_OPTIONS, ...stored }), [stored])
  const set = (patch: Partial<FrequencyOptions>) => setOptions({ ...options, ...patch })
  const [sort, setSort] = useState<{ key: FrequencySortKey; dir: 'asc' | 'desc' }>({ key: 'count', dir: 'desc' })
  const [minDraft, setMinDraft] = useState(String(options.minLength))
  useEffect(() => setMinDraft(String(options.minLength)), [options.minLength])
  const worker = useWorker<Tasks>(() => new FrequencyWorker({ name: 'devtoolkit-word-frequency' }))
  const task = useTask<{ result: FrequencyResult; text: string; key: string }>()

  useIncomingInput(setInput)

  const source = useDebouncedValue(input, adaptiveDelay(input.length))
  const optKey = JSON.stringify(options)
  const big = source.length > WORKER_THRESHOLD
  const sync = useMemo(() => (big ? null : wordFrequency(source, options)), [big, source, options])

  const { run } = task
  useEffect(() => {
    if (!big) return
    void run(async (signal) => ({ result: await worker.run('frequency', { text: source, options }, signal), text: source, key: optKey }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big, source, optKey, run, worker])

  const workerCurrent = !!task.result && task.result.text === source && task.result.key === optKey
  const result = sync ?? task.result?.result ?? null
  const stale = big && !workerCurrent
  const rows = useMemo(() => (result ? sortRows(result.rows, sort.key, sort.dir) : []), [result, sort])
  const maxCount = result?.rows[0]?.count ?? 1

  const onSort = (key: FrequencySortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'term' || key === 'rank' ? 'asc' : 'desc' }))

  const noun = options.n === 1 ? ['word', 'words'] : options.n === 2 ? ['two-word phrase', 'two-word phrases'] : ['three-word phrase', 'three-word phrases']
  const base = `word-frequency-${options.n === 1 ? 'words' : `${options.n}-grams`}`

  const toolbar = (
    <Toolbar>
      <Segmented
        aria-label="Term length"
        value={String(options.n) as '1' | '2' | '3'}
        onValueChange={(n) => set({ n: Number(n) as 1 | 2 | 3 })}
        options={[
          { value: '1', label: 'Words' },
          { value: '2', label: 'Bigrams' },
          { value: '3', label: 'Trigrams' },
        ]}
      />
      <ToolbarSeparator />
      <Checkbox checked={!options.caseSensitive} onCheckedChange={(v) => set({ caseSensitive: v !== true })} label="Ignore case" />
      <Checkbox checked={options.excludeStopWords} onCheckedChange={(v) => set({ excludeStopWords: v === true })} label="Hide stop words" />
      <Checkbox checked={options.excludeNumbers} onCheckedChange={(v) => set({ excludeNumbers: v === true })} label="Hide numbers" />
      <ToolbarSeparator />
      <ToolbarField label="Min length">
        <Input
          aria-label="Minimum word length"
          inputMode="numeric"
          value={minDraft}
          onChange={(e) => {
            setMinDraft(e.target.value)
            const n = Number(e.target.value)
            if (Number.isInteger(n) && n >= 1 && n <= 50) set({ minLength: n })
          }}
          onBlur={() => setMinDraft(String(options.minLength))}
          aria-invalid={!(Number.isInteger(Number(minDraft)) && Number(minDraft) >= 1 && Number(minDraft) <= 50)}
          className="h-7 w-12 px-2 text-right text-xs tabular"
        />
      </ToolbarField>
      <Select aria-label="Number of terms to show" value={String(options.topN)} onValueChange={(t) => set({ topN: Number(t) })} options={TOP_OPTIONS} />
    </Toolbar>
  )

  const inputPane = (
    <InputEditorPane
      value={input}
      onChange={setInput}
      sample={SAMPLE}
      title="Text"
      path="word-frequency-input"
      wordWrap
      placeholder="Paste an article, transcript, log or any text…"
      emptyState={<EmptyState compact title="Paste text to rank its words" description="Switch to bigrams or trigrams to find recurring phrases." />}
    />
  )

  const exportMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="ghost" disabled={!rows.length} className="text-muted">
          <Download /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => result && downloadText(frequencyToCsv(rows, options.n), `${base}.csv`, 'text/csv;charset=utf-8')}>CSV (.csv)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => result && downloadText(frequencyToJson(result, rows, options.n), `${base}.json`, 'application/json;charset=utf-8')}>JSON (.json)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const tablePane = (
    <Pane aria-label="Frequency table" className="@container">
      <PaneHeader
        title={options.n === 1 ? 'Words' : 'Phrases'}
        meta={result && input ? `${formatNumber(result.uniqueTerms)} distinct · ${formatNumber(result.countedTerms)} counted` : undefined}
        actions={
          <>
            {stale && task.running && (
              <span className="mr-1 flex items-center gap-1.5 text-2xs text-subtle">
                <Loader2 className="size-3 animate-spin" />
                <button type="button" className="hover:text-fg" onClick={task.cancel} aria-label="Cancel">
                  <X className="size-3" />
                </button>
              </span>
            )}
            {exportMenu}
            <CopyButton label="Copy as term⇥count (TSV)" value={() => frequencyToTsv(rows)} disabled={!rows.length} />
          </>
        }
      />
      {task.error && big && <ErrorDisplay error={task.error.message} title="Could not count terms" />}
      <div className={cn('grid h-8 shrink-0 items-center gap-3 border-b border-border bg-bg/60 px-3', COLS)} role="row">
        <SortHeader label="#" k="rank" sort={sort} onSort={onSort} className="justify-self-end" />
        <SortHeader label={options.n === 1 ? 'Word' : 'Phrase'} k="term" sort={sort} onSort={onSort} />
        <SortHeader label="Count" k="count" sort={sort} onSort={onSort} className="justify-self-end" />
        <span className="eyebrow justify-self-end">Share</span>
        <span aria-hidden className="hidden @md:block" />
      </div>
      <PaneBody>
        {!input ? (
          <EmptyState compact title="Ranked terms appear here" description="Rank, count and share of every word or phrase. Sort by any column; export as CSV or JSON." />
        ) : result && rows.length === 0 ? (
          <EmptyState
            compact
            title={`No ${noun[1]} to show`}
            description={result.totalTerms === 0 ? (options.n > 1 ? 'Phrases never cross sentence ends or line breaks — this text has no run that long.' : 'The text contains no words.') : 'Everything was filtered out. Loosen the filters (stop words, numbers, minimum length).'}
          />
        ) : (
          <FrequencyTable rows={rows} maxCount={maxCount} dim={stale} />
        )}
      </PaneBody>
      {result && result.truncated && input && (
        <div className="flex h-7 shrink-0 items-center border-t border-border px-3 text-2xs text-subtle">
          Showing the top {formatNumber(result.rows.length)} of {formatNumber(result.uniqueTerms)} — choose “All terms” to see every one.
        </div>
      )}
    </Pane>
  )

  return (
    <>
      {toolbar}
      <SplitPane id="word-frequency" initial={0.48} min={260} mobileTabs={['Text', 'Frequency']}>
        {inputPane}
        {tablePane}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Words">{result && input ? formatNumber(result.words) : '—'}</StatusItem>
        {options.n > 1 && <StatusItem label={options.n === 2 ? 'Bigrams' : 'Trigrams'}>{result && input ? formatNumber(result.totalTerms) : '—'}</StatusItem>}
        <StatusItem label="Distinct">{result && input ? formatNumber(result.uniqueTerms) : '—'}</StatusItem>
        <StatusItem label="Shown">{result && input ? pluralize(result.rows.length, 'row') : '—'}</StatusItem>
        <StatusItem label="Share of">{options.n === 1 ? 'all words' : `all ${noun[1]}`}</StatusItem>
        {big && <StatusItem tone="mod">Worker</StatusItem>}
        {big && workerCurrent && task.duration != null && <StatusItem label="Time">{formatDuration(task.duration)}</StatusItem>}
        <StatusSpacer />
        <Badge tone="neutral">Processed locally</Badge>
      </StatusBar>
    </>
  )
}
