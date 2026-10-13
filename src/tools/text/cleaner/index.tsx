import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronDown, Layers, ListPlus, Loader2, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { OP_INFO, OPS, PRESETS, runPipeline, type CleanerOp, type OpInfo, type PipelineResult, type PipelineStep, type StepReport } from '@/engines/text/cleaner'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane, OutputEditorPane, useTextMetrics } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/utils/cn'
import { formatBytes, formatDuration, formatNumber, pluralize } from '@/utils/format'
import { StepParams } from './StepParams'
import CleanerWorker from './worker.ts?worker'
import type { Tasks } from './worker'

/** Above this many characters the pipeline runs in a worker (cancellable). */
const LARGE_INPUT = 300_000

const SAMPLE = `  Subscribers export — copied from the CRM  \r
\r
  ana.lopez@example.com\t\tAna López   (signed up 2024-03-02)\r
bob+news@mail.co.uk    Bob   Smith\r
  ana.lopez@example.com\t\tAna López   (signed up 2024-03-02)\r
\r
\r
<b>chen.wei@example.org</b>   Chen &amp; Co.\r
  dmitri@example.net      Dmitri    Ivanov   \r
bob+news@mail.co.uk    Bob   Smith\r
Zoë Ångström <zoe@example.se>   follow @zoe_dev  #newsletter\r
`

const GROUPS: OpInfo['group'][] = ['Whitespace', 'Lines', 'Order', 'Characters', 'Extract']

const newId = () => crypto.randomUUID()
const toSteps = (ops: CleanerOp[]): PipelineStep[] => ops.map((op) => ({ id: newId(), enabled: true, op }))
const DEFAULT_STEPS = toSteps(PRESETS[0].ops)

/** Fills in defaults for steps restored from an older draft and drops unknown operations. */
function sanitize(steps: PipelineStep[]): PipelineStep[] {
  return steps.filter((s) => s && OP_INFO.has(s.op?.kind)).map((s) => ({ ...s, op: { ...OP_INFO.get(s.op.kind)!.defaults, ...s.op } as CleanerOp }))
}

function AddStepMenu({ onAdd, variant = 'secondary' }: { onAdd: (op: CleanerOp) => void; variant?: 'secondary' | 'ghost' | 'primary' }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant={variant}>
          <Plus /> Add step <ChevronDown className="text-subtle" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(520px,var(--radix-dropdown-menu-content-available-height))] w-72 overflow-y-auto">
        {GROUPS.map((g, gi) => (
          <div key={g}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{g}</DropdownMenuLabel>
            {OPS.filter((o) => o.group === g).map((o) => (
              <DropdownMenuItem key={o.kind} onSelect={() => onAdd(o.defaults)} className="h-auto items-start py-1.5">
                <div className="flex min-w-0 flex-col">
                  <span>{o.label}</span>
                  <span className="truncate text-2xs text-subtle">{o.description}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PresetMenu({ onPick }: { onPick: (ops: CleanerOp[], label: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost">
          <Layers /> Presets <ChevronDown className="text-subtle" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Replace pipeline with</DropdownMenuLabel>
        {PRESETS.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => onPick(p.ops, p.label)} className="h-auto items-start py-1.5">
            <div className="flex min-w-0 flex-col">
              <span>{p.label}</span>
              <span className="text-2xs text-subtle">
                {p.description} · {pluralize(p.ops.length, 'step')}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StepRow({
  step,
  index,
  count,
  report,
  pending,
  onChange,
  onMove,
  onRemove,
}: {
  step: PipelineStep
  index: number
  count: number
  report?: StepReport
  pending: boolean
  onChange: (s: PipelineStep) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const info = OP_INFO.get(step.op.kind)!
  const label = step.op.kind === 'extract' ? `Extract ${step.op.what === 'letters' ? 'words' : step.op.what}` : info.label
  return (
    <li className={cn('group border-b border-border px-3 pb-2.5 pt-2', !step.enabled && 'bg-bg/40')} aria-label={`Step ${index + 1}: ${label}`}>
      <div className="flex h-7 items-center gap-2">
        <span className="mono w-4 shrink-0 text-right text-2xs text-subtle tabular">{index + 1}</span>
        <Switch checked={step.enabled} onCheckedChange={(enabled) => onChange({ ...step, enabled })} aria-label={`${step.enabled ? 'Disable' : 'Enable'} ${label}`} />
        <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', !step.enabled && 'text-subtle line-through decoration-border-strong')} title={info.description}>
          {label}
        </span>
        <div className="flex shrink-0 items-center opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <IconButton size="icon-xs" label="Move up" icon={<ArrowUp />} disabled={index === 0} onClick={() => onMove(-1)} />
          <IconButton size="icon-xs" label="Move down" icon={<ArrowDown />} disabled={index === count - 1} onClick={() => onMove(1)} />
          <IconButton size="icon-xs" label="Remove step" icon={<X />} onClick={onRemove} />
        </div>
      </div>
      <div className={cn('mt-1 flex flex-col gap-1 pl-6', !step.enabled && 'opacity-60')}>
        <StepParams op={step.op} onChange={(op) => onChange({ ...step, op })} />
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 pl-6 text-2xs tabular">
        {step.enabled && report ? (
          <>
            <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', report.changed ? 'bg-accent' : 'bg-border-strong')} />
            <span className={cn('truncate', report.changed ? 'text-accent-text' : 'text-subtle', pending && 'opacity-50')}>{report.summary}</span>
            {report.changed && <span className="ml-auto shrink-0 text-subtle">{formatNumber(report.length)} chars</span>}
          </>
        ) : (
          <span className="text-subtle">{step.enabled ? (pending ? 'Waiting for input…' : '—') : 'Disabled — skipped'}</span>
        )}
      </p>
    </li>
  )
}

export default function TextCleaner() {
  const [input, setInput] = usePersistentState('input', '')
  const [storedSteps, setSteps] = usePersistentState<PipelineStep[]>('steps', DEFAULT_STEPS)
  const steps = useMemo(() => sanitize(storedSteps), [storedSteps])
  const inputRef = useRef<CodeEditorHandle>(null)
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<'pipeline' | 'input' | 'output'>('input')
  const worker = useWorker<Tasks>(() => new CleanerWorker({ name: 'devtoolkit-text-cleaner' }))
  const task = useTask<{ result: PipelineResult; text: string; steps: PipelineStep[] }>()

  useIncomingInput(setInput)

  const source = useDebouncedValue(input, adaptiveDelay(input.length))
  const isLarge = source.length > LARGE_INPUT

  const sync = useMemo(() => {
    if (isLarge) return null
    try {
      return { result: runPipeline(source, steps), error: null as string | null }
    } catch (e) {
      return { result: null, error: (e as Error).message }
    }
  }, [source, steps, isLarge])

  // Large input: run in the worker whenever input or pipeline changes (latest wins, cancellable).
  const { run: runTask, cancel: cancelTask } = task
  const [cancelled, setCancelled] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const runInWorker = useCallback(
    (text: string, s: PipelineStep[]) => {
      setCancelled(false)
      void runTask(async (signal) => ({ result: await worker.run('pipeline', { text, steps: s }, signal), text, steps: s }))
    },
    [runTask, worker],
  )
  useEffect(() => {
    if (!isLarge) return
    timer.current = setTimeout(() => runInWorker(source, steps), 250)
    return () => clearTimeout(timer.current)
  }, [isLarge, source, steps, runInWorker])
  const cancel = () => {
    clearTimeout(timer.current)
    cancelTask()
    setCancelled(true)
  }

  const workerCurrent = !!task.result && task.result.text === source && task.result.steps === steps
  const result: PipelineResult | null = sync ? sync.result : (task.result?.result ?? null)
  const output = result?.output ?? ''
  const reports = useMemo(() => new Map((result?.steps ?? []).map((r) => [r.id, r])), [result])
  const stale = isLarge && !workerCurrent
  const busy = stale && !cancelled && !task.error
  const totalMs = result?.steps.reduce((a, s) => a + s.ms, 0) ?? 0

  const inMetrics = useTextMetrics(input)
  const outMetrics = useTextMetrics(output)
  const outLines = outMetrics.lines
  const lineDelta = output || input ? outLines - inMetrics.lines : 0
  const charDelta = output.length - source.length

  const update = (next: PipelineStep[]) => setSteps(next)
  const add = (op: CleanerOp) => {
    update([...steps, { id: newId(), enabled: true, op }])
    if (isMobile) setMobileTab('pipeline')
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const next = steps.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    update(next)
  }
  const applyPreset = (ops: CleanerOp[], label: string) => {
    const prev = steps
    update(toSteps(ops))
    toast.message(`Pipeline set to “${label}”`, { action: { label: 'Undo', onClick: () => setSteps(prev) } })
  }
  const clearSteps = () => {
    const prev = steps
    update([])
    toast.message('Pipeline cleared', { action: { label: 'Undo', onClick: () => setSteps(prev) } })
  }
  const applyToInput = () => {
    if (!output) return
    if (inputRef.current?.editor) inputRef.current.replaceAll(output)
    else setInput(output)
    toast.message('Output moved to input', { description: 'Run the pipeline again on the cleaned text. Undo with Ctrl/⌘+Z in the input editor.' })
  }

  const enabledCount = steps.filter((s) => s.enabled).length

  const toolbar = (
    <Toolbar>
      <AddStepMenu onAdd={add} />
      <PresetMenu onPick={applyPreset} />
      <ToolbarSeparator />
      <span className="hidden whitespace-nowrap text-xs text-subtle md:inline">{steps.length ? `${enabledCount} of ${pluralize(steps.length, 'step')} active · runs top to bottom` : 'Build a pipeline of cleaning steps'}</span>
      <ToolbarSpacer />
      <Button size="sm" variant="ghost" onClick={applyToInput} disabled={!output || output === input}>
        <ArrowLeftRight /> Use as input
      </Button>
    </Toolbar>
  )

  const pipeline = (
    <aside aria-label="Pipeline" className="flex min-h-0 flex-1 flex-col bg-workspace">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
        <h2 className="eyebrow">Pipeline</h2>
        <span className="text-2xs text-subtle tabular">{steps.length ? pluralize(steps.length, 'step') : ''}</span>
        <div className="ml-auto flex items-center">
          <IconButton label="Remove all steps" icon={<Trash2 />} onClick={clearSteps} disabled={!steps.length} />
        </div>
      </div>
      {steps.length === 0 ? (
        <EmptyState
          compact
          icon={<ListPlus />}
          title="No cleaning steps yet"
          description="Add steps one by one, or start from a preset. Steps run in order, each on the previous step's result."
          actions={
            <>
              <AddStepMenu onAdd={add} variant="primary" />
            </>
          }
        />
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto">
          {steps.map((s, i) => (
            <StepRow
              key={s.id}
              step={s}
              index={i}
              count={steps.length}
              report={input ? reports.get(s.id) : undefined}
              pending={busy}
              onChange={(next) => update(steps.map((x) => (x.id === s.id ? next : x)))}
              onMove={(d) => move(i, d)}
              onRemove={() => update(steps.filter((x) => x.id !== s.id))}
            />
          ))}
          <li className="px-3 py-3">
            <AddStepMenu onAdd={add} variant="ghost" />
          </li>
        </ol>
      )}
    </aside>
  )

  const banner = isLarge ? (
    task.error && !busy ? (
      <ErrorDisplay error={task.error.message} title="Pipeline failed" action={<Button size="xs" variant="ghost" onClick={() => runInWorker(source, steps)}>Retry</Button>} />
    ) : busy ? (
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-1.5 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin" />
        <span className="flex-1">Cleaning {formatBytes(inMetrics.bytes)} in a background worker…</span>
        <Button size="xs" variant="ghost" onClick={cancel}>
          <X /> Cancel
        </Button>
      </div>
    ) : stale ? (
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-1.5 text-xs text-muted">
        <span className="flex-1">Cancelled — {task.result ? 'the output below is out of date.' : 'no output yet.'}</span>
        <Button size="xs" variant="secondary" onClick={() => runInWorker(source, steps)}>
          Run now
        </Button>
      </div>
    ) : null
  ) : sync?.error ? (
    <ErrorDisplay error={sync.error} title="Pipeline failed" />
  ) : null

  const inputPane = (
    <InputEditorPane
      ref={inputRef}
      value={input}
      onChange={setInput}
      sample={SAMPLE}
      placeholder="Paste messy text, a list, CSV column or HTML…"
      path="cleaner-input"
      emptyState={<EmptyState compact title="Paste text to clean" description="The pipeline runs live as you type. Try “Load sample” to see each step's effect." />}
    />
  )

  const outputPane = (
    <OutputEditorPane
      value={output}
      title="Cleaned"
      filename="cleaned.txt"
      banner={banner}
      path="cleaner-output"
      meta={
        input && result ? (
          <span>
            <span className={cn(lineDelta < 0 && 'text-del', lineDelta > 0 && 'text-add')}>{lineDelta === 0 ? 'same line count' : `${lineDelta > 0 ? '+' : '−'}${formatNumber(Math.abs(lineDelta))} lines`}</span>
            {' · '}
            <span className={cn(charDelta < 0 && 'text-del', charDelta > 0 && 'text-add')}>{charDelta === 0 ? '±0' : `${charDelta > 0 ? '+' : '−'}${formatNumber(Math.abs(charDelta))}`} chars</span>
          </span>
        ) : undefined
      }
      emptyState={
        !input ? (
          <EmptyState compact title="Cleaned text appears here" description="Each step's effect is summarised under it in the pipeline." />
        ) : steps.length === 0 ? (
          <EmptyState compact title="Nothing to run" description="Add a step or pick a preset to transform the input." />
        ) : result && !output ? (
          <EmptyState compact title="The pipeline produced empty output" description="A step removed everything — check the summaries in the pipeline (e.g. an extraction that found nothing)." />
        ) : undefined
      }
    />
  )

  const status = (
    <StatusBar>
      <StatusItem label="Steps">
        {enabledCount}/{steps.length}
      </StatusItem>
      <StatusItem label="Lines">
        {formatNumber(inMetrics.lines)} → {formatNumber(outLines)}
      </StatusItem>
      <StatusItem label="Size">
        {formatBytes(inMetrics.bytes)} → {formatBytes(outMetrics.bytes)}
      </StatusItem>
      {result && input && <StatusItem label="Time">{formatDuration(isLarge && task.duration != null ? task.duration : totalMs)}</StatusItem>}
      {isLarge && <StatusItem tone="mod">Worker</StatusItem>}
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
              { value: 'pipeline', label: `Pipeline (${steps.length})` },
              { value: 'input', label: 'Input' },
              { value: 'output', label: 'Output' },
            ]}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{mobileTab === 'pipeline' ? pipeline : mobileTab === 'input' ? inputPane : outputPane}</div>
        {status}
      </>
    )
  }

  return (
    <>
      {toolbar}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[320px] shrink-0 flex-col border-r border-border xl:w-[360px]">{pipeline}</div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SplitPane id="cleaner-io" initial={0.5} min={200}>
            {inputPane}
            {outputPane}
          </SplitPane>
        </div>
      </div>
      {status}
    </>
  )
}
