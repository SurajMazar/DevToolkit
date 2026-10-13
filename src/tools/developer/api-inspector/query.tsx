import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ExternalLink, Loader2, Search } from 'lucide-react'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { SplitPane } from '@/components/tools/SplitPane'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Segmented } from '@/components/ui/segmented'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/common/CopyButton'
import { buttonVariants } from '@/components/ui/button'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useTask } from '@/hooks/useTask'
import { useWorker } from '@/hooks/useWorker'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import type { CompareEntry, CompareResult, PathEntry, SearchHit } from '@/engines/dev/api-inspect'
import type { JsonErrorInfo } from '@/engines/json/parse'
import { VirtualList } from '../_shared/VirtualList'
import { TYPE_TEXT } from './panels'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'
import InspectWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const newWorker = () => new InspectWorker({ name: 'api-inspector-query' })

export function SearchPanel({ text }: { text: string }) {
  const [query, setQuery] = usePersistentState('searchQuery', '')
  const [opts, setOpts] = usePersistentState('searchOpts', { keys: true, values: true, caseSensitive: false, exact: false })
  const worker = useWorker<Tasks>(newWorker)
  const task = useTask<{ hits: SearchHit[]; total: number }>()
  const q = useDebouncedValue(query, 150)
  useEffect(() => {
    if (!q) {
      task.reset()
      return
    }
    void task.run((signal) => worker.run('search', { text, query: q, ...opts }, signal))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, text, opts.keys, opts.values, opts.caseSensitive, opts.exact])
  const hits = q ? (task.result?.hits ?? []) : []
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search keys and values…" aria-label="Search" className="pl-8" autoFocus />
        </div>
        <Checkbox checked={opts.keys} onCheckedChange={(v) => setOpts({ ...opts, keys: v === true })} label="Keys" />
        <Checkbox checked={opts.values} onCheckedChange={(v) => setOpts({ ...opts, values: v === true })} label="Values" />
        <Checkbox checked={opts.caseSensitive} onCheckedChange={(v) => setOpts({ ...opts, caseSensitive: v === true })} label="Match case" />
        <Checkbox checked={opts.exact} onCheckedChange={(v) => setOpts({ ...opts, exact: v === true })} label="Whole value" />
      </div>
      {task.error && <ErrorDisplay error={task.error.message} />}
      {q && task.result && (
        <p className="border-b border-border px-4 py-1.5 text-2xs text-subtle tabular">
          {formatNumber(task.result.total)} matches{task.result.total > task.result.hits.length ? ` — showing the first ${formatNumber(task.result.hits.length)}` : ''}
          {task.running && <Loader2 className="ml-2 inline size-3 animate-spin" />}
        </p>
      )}
      {!q ? (
        <p className="px-4 py-6 text-sm text-muted">Type to find keys or values anywhere in the document. Results show the JSONPath of each match.</p>
      ) : (
        <VirtualList
          items={hits}
          estimateSize={44}
          getKey={(h, i) => `${h.path}:${h.in}:${i}`}
          aria-label="Search results"
          footer={task.result && !hits.length ? <p className="px-4 py-6 text-sm text-muted">No matches for “{q}”.</p> : null}
          renderItem={(h) => (
            <div className="group flex items-start gap-2 border-b border-border px-4 py-1.5">
              <Badge tone={h.in === 'key' ? 'accent' : 'neutral'} className="mt-0.5">
                {h.in}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="mono truncate text-[12.5px] text-fg" title={h.path}>
                  {h.path}
                </p>
                <p className="mono truncate text-[12px] text-subtle">
                  <span className={cn('mr-1.5', TYPE_TEXT[h.type])}>{h.type}</span>
                  {h.preview}
                </p>
              </div>
              <CopyButton value={h.path} label="Copy path" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
            </div>
          )}
        />
      )}
    </div>
  )
}

export function PathsPanel({ text }: { text: string }) {
  const [mode, setMode] = usePersistentState<'all' | 'leaves'>('pathsMode', 'leaves')
  const [norm, setNorm] = usePersistentState<'concrete' | 'normalized'>('pathsNorm', 'concrete')
  const [filter, setFilter] = useState('')
  const worker = useWorker<Tasks>(newWorker)
  const task = useTask<{ paths: PathEntry[]; total: number }>()
  useEffect(() => {
    void task.run((signal) => worker.run('paths', { text, leafOnly: mode === 'leaves', normalized: norm === 'normalized' }, signal))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, mode, norm])
  const f = useDebouncedValue(filter, 120)
  const shown = useMemo(() => {
    const all = task.result?.paths ?? []
    if (!f) return all
    const q = f.toLowerCase()
    return all.filter((p) => p.path.toLowerCase().includes(q))
  }, [task.result, f])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2">
        <Segmented
          size="xs"
          aria-label="Which paths"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'leaves', label: 'Leaves', tooltip: 'Only values (and empty containers)' },
            { value: 'all', label: 'All nodes' },
          ]}
        />
        <Segmented
          size="xs"
          aria-label="Array indices"
          value={norm}
          onValueChange={setNorm}
          options={[
            { value: 'concrete', label: '[0], [1]…', tooltip: 'Every concrete path' },
            { value: 'normalized', label: '[*]', tooltip: 'Unique paths with array indices collapsed' },
          ]}
        />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter paths…" aria-label="Filter paths" className="h-7 min-w-[140px] flex-1" />
        <CopyButton value={() => shown.map((p) => p.path).join('\n')} label={`Copy ${formatNumber(shown.length)} paths`} showLabel disabled={!shown.length} />
      </div>
      {task.error && <ErrorDisplay error={task.error.message} />}
      {task.result && (
        <p className="border-b border-border px-4 py-1.5 text-2xs text-subtle tabular">
          {f ? `${formatNumber(shown.length)} of ` : ''}
          {formatNumber(task.result.total)} paths
          {task.result.total > task.result.paths.length && ` — the first ${formatNumber(task.result.paths.length)} are listed`}
        </p>
      )}
      <VirtualList
        items={shown}
        estimateSize={28}
        getKey={(p, i) => `${p.path}:${i}`}
        aria-label="Paths"
        renderItem={(p) => (
          <div className="group flex items-center gap-2 border-b border-border/60 px-4 py-1">
            <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-fg" title={p.path}>
              {p.path}
            </span>
            <span className="mono hidden max-w-[40%] shrink-0 truncate text-[12px] text-subtle sm:inline">{p.preview}</span>
            <CopyButton value={p.path} label="Copy path" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
          </div>
        )}
      />
    </div>
  )
}

type Row = { kind: 'section'; title: string; count: number; tone: 'add' | 'del' | 'mod' | 'accent' } | { kind: 'entry'; section: 'added' | 'removed' | 'typeChanged' | 'valueChanged'; e: CompareEntry }

const TONE_TEXT = { add: 'text-add', del: 'text-del', mod: 'text-mod', accent: 'text-accent-text' } as const

const SECTIONS = [
  { key: 'added', title: 'Added in B', tone: 'add' },
  { key: 'removed', title: 'Removed in B', tone: 'del' },
  { key: 'typeChanged', title: 'Type changed', tone: 'accent' },
  { key: 'valueChanged', title: 'Value changed', tone: 'mod' },
] as const

export function ComparePanel({ text, textB, setTextB, sampleB }: { text: string; textB: string; setTextB: (v: string) => void; sampleB: string }) {
  const [mode, setMode] = usePersistentState<'paths' | 'schema'>('compareMode', 'paths')
  const worker = useWorker<Tasks>(newWorker)
  const task = useTask<{ ok: true; result: CompareResult } | { ok: false; side: 'A' | 'B'; error: JsonErrorInfo }>()
  const b = useDebouncedValue(textB, adaptiveDelay(textB.length) + 120)
  const editorB = useRef<CodeEditorHandle>(null)
  useEffect(() => {
    if (!b.trim() || !text.trim()) {
      task.reset()
      return
    }
    void task.run((signal) => worker.run('compare', { a: text, b, mode }, signal))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, b, mode])
  const r = task.result
  const rows = useMemo<Row[]>(() => {
    if (!r || !r.ok) return []
    const out: Row[] = []
    for (const s of SECTIONS) {
      const list = r.result[s.key]
      const count = r.result.counts[s.key]
      if (!count) continue
      out.push({ kind: 'section', title: s.title, count, tone: s.tone })
      for (const e of list) out.push({ kind: 'entry', section: s.key, e })
    }
    return out
  }, [r])

  const results = (
    <div className="flex min-h-0 flex-1 flex-col bg-workspace">
      <div className="flex h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3">
        <h3 className="eyebrow">Differences</h3>
        <Segmented
          size="xs"
          aria-label="Comparison mode"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'paths', label: 'Values', tooltip: 'Compare every concrete path and value' },
            { value: 'schema', label: 'Structure only', tooltip: 'Ignore array indices and values; compare paths and types' },
          ]}
        />
        {task.running && <Loader2 className="size-3.5 animate-spin text-subtle" />}
        <Link to="/compare/json" className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'ml-auto')} title="Opens the JSON Diff tool. Paste the two responses there for a line-by-line diff.">
          JSON Diff <ExternalLink />
        </Link>
      </div>
      {r && r.ok && (
        <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-xs tabular">
          <span className="text-add">+{formatNumber(r.result.counts.added)} added</span>
          <span className="text-del">−{formatNumber(r.result.counts.removed)} removed</span>
          <span className="text-accent-text">{formatNumber(r.result.counts.typeChanged)} type changed</span>
          {mode === 'paths' && <span className="text-mod">{formatNumber(r.result.counts.valueChanged)} value changed</span>}
          <span className="text-subtle">{formatNumber(r.result.counts.unchanged)} unchanged</span>
        </div>
      )}
      {r && !r.ok && <ErrorDisplay title={`Response ${r.side} is not valid JSON`} error={{ message: r.error.message, line: r.error.line, column: r.error.column }} onLocate={r.side === 'B' ? (l, c) => editorB.current?.revealPosition(l, c) : undefined} />}
      {task.error && <ErrorDisplay error={task.error.message} />}
      {!textB.trim() ? (
        <p className="px-4 py-6 text-sm text-muted">Paste a second response (B) above to compare its structure with the main input (A).</p>
      ) : r && r.ok && rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">{mode === 'schema' ? 'Same structure: every path has the same types.' : 'The two responses are identical.'}</p>
      ) : (
        <VirtualList
          items={rows}
          estimateSize={28}
          getKey={(row, i) => (row.kind === 'section' ? `s:${row.title}` : `${row.section}:${row.e.path}:${i}`)}
          aria-label="Differences"
          renderItem={(row) =>
            row.kind === 'section' ? (
              <div className="flex items-center gap-2 border-b border-border bg-surface/60 px-4 py-1">
                <span className="eyebrow">{row.title}</span>
                <span className={cn('text-2xs tabular', TONE_TEXT[row.tone])}>{formatNumber(row.count)}</span>
                {r && r.ok && row.count > 2000 && <span className="text-2xs text-subtle">first 2,000 listed</span>}
              </div>
            ) : (
              <div className="group flex items-center gap-2 border-b border-border/60 px-4 py-1">
                <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-fg" title={row.e.path}>
                  {row.e.path}
                </span>
                <span className="mono max-w-[50%] shrink-0 truncate text-[12px]">
                  {row.section === 'added' && <span className="text-add">{row.e.to ?? row.e.type}</span>}
                  {row.section === 'removed' && <span className="text-del">{row.e.from ?? row.e.type}</span>}
                  {(row.section === 'typeChanged' || row.section === 'valueChanged') && (
                    <>
                      <span className="text-del">{row.e.from}</span>
                      <span className="px-1 text-subtle">→</span>
                      <span className="text-add">{row.e.to}</span>
                    </>
                  )}
                </span>
                <CopyButton value={row.e.path} label="Copy path" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
              </div>
            )
          }
        />
      )}
    </div>
  )

  return (
    <SplitPane direction="vertical" id="api-compare" initial={0.4} min={100}>
      <InputEditorPane
        ref={editorB}
        title="Response B"
        value={textB}
        onChange={setTextB}
        language="json"
        sample={sampleB}
        sampleLabel="Load a modified sample"
        path="api-inspector-b"
        placeholder="Paste a second response to compare structurally…"
        footer={false}
      />
      {results}
    </SplitPane>
  )
}
