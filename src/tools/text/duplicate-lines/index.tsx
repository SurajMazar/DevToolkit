import { useEffect, useMemo, useRef, useState } from 'react'
import { CopyX, Loader2, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  buildDuplicateOutput,
  DEFAULT_DUPLICATE_OPTIONS,
  findDuplicates,
  OUTPUT_LABELS,
  type DuplicateGroup,
  type DuplicateOptions,
  type DuplicateOutput,
  type DuplicateReport,
} from '@/engines/text/duplicates'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane, OutputEditorPane } from '@/components/tools/EditorPane'
import { Pane, PaneBody, PaneHeader } from '@/components/tools/Pane'
import { Toolbar, ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Checkbox } from '@/components/ui/checkbox'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CopyButton } from '@/components/common/CopyButton'
import { cn } from '@/utils/cn'
import { formatDuration, formatNumber, pluralize } from '@/utils/format'
import DupWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const WORKER_THRESHOLD = 200_000
const INLINE_LINES = 8
const ROW_H = 52

const SAMPLE = `import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/utils/cn'
import { useState } from 'react'
import { formatBytes } from '@/utils/format'
import { cn } from '@/utils/cn'
import { toast } from 'sonner'
import { useMemo } from 'react'
import { cn }  from '@/utils/cn'
import { formatBytes } from '@/utils/format'

ERROR  Connection refused (db-primary)
WARN   Slow query: 1532ms
ERROR  Connection refused (db-primary)
INFO   Retrying in 5s
error  connection refused (db-primary)
INFO   Retrying in 5s
ERROR  Connection refused (db-primary)`

type Analysis = { report: DuplicateReport; output: string }

function LineChip({ n, onClick }: { n: number; onClick: (n: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(n)}
      className="mono h-5 rounded-sm bg-surface-2/70 px-1.5 text-2xs text-muted tabular transition-colors hover:bg-accent-soft hover:text-accent-text focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Go to line ${n}`}
    >
      {n}
    </button>
  )
}

function GroupRow({ g, onLine, top, trimmed }: { g: DuplicateGroup; onLine: (n: number) => void; top: number; trimmed: boolean }) {
  const extra = g.lines.length - INLINE_LINES
  const shown = trimmed ? g.text.trim() : g.text
  return (
    <div className="absolute inset-x-0 flex flex-col justify-center gap-1 border-b border-border/60 px-3 hover:bg-surface-2/40" style={{ top, height: ROW_H }}>
      <div className="flex min-w-0 items-center gap-2">
        <Badge tone="mod" className="mono shrink-0">
          ×{formatNumber(g.count)}
        </Badge>
        <span className={cn('mono min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-pre text-[12.5px]', g.text.trim() === '' && 'italic text-subtle')} title={g.text}>
          {g.text.trim() === '' ? '(blank line)' : shown.replace(/\t/g, '→')}
        </span>
        {g.variants && (
          <span className="shrink-0 text-2xs text-subtle" title="Occurrences differ in case or surrounding whitespace">
            variants
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1 overflow-hidden pl-[1px]">
        <span className="mr-0.5 shrink-0 text-2xs text-subtle">Lines</span>
        {g.lines.slice(0, INLINE_LINES).map((n) => (
          <LineChip key={n} n={n} onClick={onLine} />
        ))}
        {extra > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="h-5 shrink-0 rounded-sm px-1.5 text-2xs text-accent-text hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-ring">
                +{formatNumber(extra)} more
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-2">
              <p className="mb-1.5 px-1 text-xs text-muted">All {formatNumber(g.lines.length)} occurrences</p>
              <div className="flex max-h-60 flex-wrap gap-1 overflow-y-auto">
                {g.lines.slice(0, 5000).map((n) => (
                  <LineChip key={n} n={n} onClick={onLine} />
                ))}
              </div>
              {g.lines.length > 5000 && <p className="mt-1.5 px-1 text-2xs text-subtle">First 5,000 shown.</p>}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  )
}

function GroupList({ groups, onLine, trimmed }: { groups: DuplicateGroup[]; onLine: (n: number) => void; trimmed: boolean }) {
  const parent = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: groups.length, getScrollElement: () => parent.current, estimateSize: () => ROW_H, overscan: 10 })
  return (
    <div ref={parent} className="absolute inset-0 overflow-auto" role="list" aria-label="Duplicated lines">
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((it) => (
          <GroupRow key={it.key} g={groups[it.index]} onLine={onLine} top={it.start} trimmed={trimmed} />
        ))}
      </div>
    </div>
  )
}

export default function DuplicateLines() {
  const [input, setInput] = usePersistentState('input', '')
  const [stored, setOptions] = usePersistentState<DuplicateOptions>('options', DEFAULT_DUPLICATE_OPTIONS)
  const [outputKind, setOutputKind] = usePersistentState<DuplicateOutput>('output', 'unique')
  const options = useMemo(() => ({ ...DEFAULT_DUPLICATE_OPTIONS, ...stored }), [stored])
  const set = (patch: Partial<DuplicateOptions>) => setOptions({ ...options, ...patch })
  const inputRef = useRef<CodeEditorHandle>(null)
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<'input' | 'duplicates' | 'output'>('input')
  const worker = useWorker<Tasks>(() => new DupWorker({ name: 'devtoolkit-duplicate-lines' }))
  const task = useTask<Analysis & { text: string; key: string }>()

  useIncomingInput(setInput)

  const source = useDebouncedValue(input, adaptiveDelay(input.length))
  const key = JSON.stringify([options, outputKind])
  const big = source.length > WORKER_THRESHOLD
  const sync = useMemo<Analysis | null>(
    () => (big ? null : { report: findDuplicates(source, options), output: buildDuplicateOutput(source, outputKind, options) }),
    [big, source, options, outputKind],
  )

  const { run } = task
  useEffect(() => {
    if (!big) return
    void run(async (signal) => ({ ...(await worker.run('analyze', { text: source, options, output: outputKind }, signal)), text: source, key }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big, source, key, run, worker])

  const workerCurrent = !!task.result && task.result.text === source && task.result.key === key
  const analysis: Analysis | null = sync ?? task.result ?? null
  const stale = big && !workerCurrent
  const report = input ? analysis?.report : undefined
  const output = input ? (analysis?.output ?? '') : ''

  const goToLine = (line: number) => {
    if (isMobile) setMobileTab('input')
    requestAnimationFrame(() => {
      const ed = inputRef.current?.editor
      const model = ed?.getModel()
      if (!ed || !model || line > model.getLineCount()) return
      const range = { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: model.getLineMaxColumn(line) }
      ed.setSelection(range)
      ed.revealRangeInCenter(range)
      ed.focus()
    })
  }

  const toolbar = (
    <Toolbar>
      <Checkbox checked={options.caseInsensitive} onCheckedChange={(v) => set({ caseInsensitive: v === true })} label="Ignore case" />
      <Checkbox checked={options.trim} onCheckedChange={(v) => set({ trim: v === true })} label="Trim before comparing" />
      <Checkbox checked={options.ignoreBlank} onCheckedChange={(v) => set({ ignoreBlank: v === true })} label="Ignore blank lines" />
      <ToolbarSeparator />
      <ToolbarField label="Output">
        <Select
          aria-label="Output"
          value={outputKind}
          onValueChange={setOutputKind}
          options={(Object.keys(OUTPUT_LABELS) as DuplicateOutput[]).map((k) => ({ value: k, label: OUTPUT_LABELS[k].label, description: OUTPUT_LABELS[k].description }))}
        />
      </ToolbarField>
    </Toolbar>
  )

  const inputPane = (
    <InputEditorPane
      ref={inputRef}
      value={input}
      onChange={setInput}
      sample={SAMPLE}
      title="Lines"
      path="duplicate-lines-input"
      placeholder="Paste lines — a list, log, CSV column or source file…"
      emptyState={<EmptyState compact title="Paste lines to find repeats" description="Every repeated line is listed with how often and where it occurs." />}
    />
  )

  const summary = report ? (
    report.groups.length ? (
      <span>
        <span className="text-mod">{pluralize(report.groups.length, 'line')} repeated</span> · {formatNumber(report.redundant)} extra {report.redundant === 1 ? 'copy' : 'copies'}
      </span>
    ) : (
      <span className="text-ok">No duplicates</span>
    )
  ) : undefined

  const groupsPane = (
    <Pane aria-label="Duplicates">
      <PaneHeader
        title="Duplicates"
        meta={summary}
        actions={
          <>
            {stale && task.running && (
              <span className="mr-1 flex items-center gap-1.5 text-2xs text-subtle">
                <Loader2 className="size-3 animate-spin" /> Analysing
                <button type="button" className="hover:text-fg" onClick={task.cancel} aria-label="Cancel">
                  <X className="size-3" />
                </button>
              </span>
            )}
            <CopyButton
              label="Copy report (count⇥lines⇥text)"
              disabled={!report?.groups.length}
              value={() => (report?.groups ?? []).map((g) => `${g.count}\t${g.lines.join(',')}\t${g.text}`).join('\n')}
            />
          </>
        }
      />
      {task.error && big && <ErrorDisplay error={task.error.message} title="Analysis failed" />}
      <PaneBody className={cn(stale && 'opacity-60')}>
        {!report ? (
          <EmptyState compact icon={<CopyX />} title="Duplicated lines appear here" description="With counts and clickable line numbers. Choose what the output pane contains in the toolbar." />
        ) : report.groups.length === 0 ? (
          <EmptyState
            compact
            title={report.totalLines ? 'Every line is unique' : 'No lines'}
            description={report.totalLines ? `${pluralize(report.distinct, 'distinct line')}${options.caseInsensitive ? '' : '. Try “Ignore case” to fold Foo and foo together.'}` : undefined}
          />
        ) : (
          <GroupList groups={report.groups} onLine={goToLine} trimmed={options.trim} />
        )}
      </PaneBody>
    </Pane>
  )

  const outputPane = (
    <OutputEditorPane
      value={output}
      title="Output"
      meta={OUTPUT_LABELS[outputKind].label}
      filename={`${outputKind}-lines.txt`}
      path="duplicate-lines-output"
      emptyState={
        !input ? (
          <EmptyState compact title="Filtered lines appear here" description={OUTPUT_LABELS[outputKind].description + '.'} />
        ) : analysis && !output ? (
          <EmptyState compact title="No lines match this output" description={outputKind === 'singles' ? 'Every line has at least one duplicate.' : 'There are no repeated lines.'} />
        ) : undefined
      }
    />
  )

  const status = (
    <StatusBar>
      <StatusItem label="Lines">{report ? formatNumber(report.totalLines) : '—'}</StatusItem>
      <StatusItem label="Distinct">{report ? formatNumber(report.distinct) : '—'}</StatusItem>
      <StatusItem label="Repeated" tone={report?.groups.length ? 'mod' : undefined}>
        {report ? formatNumber(report.groups.length) : '—'}
      </StatusItem>
      <StatusItem label="Removable">{report ? formatNumber(report.redundant) : '—'}</StatusItem>
      <StatusItem label="Once">{report ? formatNumber(report.singles) : '—'}</StatusItem>
      {report && options.ignoreBlank && report.blankLines > 0 && <StatusItem label="Blank (ignored)">{formatNumber(report.blankLines)}</StatusItem>}
      {big && <StatusItem tone="mod">Worker</StatusItem>}
      {big && workerCurrent && task.duration != null && <StatusItem label="Time">{formatDuration(task.duration)}</StatusItem>}
      <StatusSpacer />
      <Badge tone="neutral">Processed locally</Badge>
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
              { value: 'input', label: 'Lines' },
              { value: 'duplicates', label: report?.groups.length ? `Duplicates (${formatNumber(report.groups.length)})` : 'Duplicates' },
              { value: 'output', label: 'Output' },
            ]}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{mobileTab === 'input' ? inputPane : mobileTab === 'duplicates' ? groupsPane : outputPane}</div>
        {status}
      </>
    )
  }

  return (
    <>
      {toolbar}
      <SplitPane id="duplicate-lines" initial={0.5} min={260}>
        {inputPane}
        <SplitPane direction="vertical" id="duplicate-lines-right" initial={0.55} min={120}>
          {groupsPane}
          {outputPane}
        </SplitPane>
      </SplitPane>
      {status}
    </>
  )
}
