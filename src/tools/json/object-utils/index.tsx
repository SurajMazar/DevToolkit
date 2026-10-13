import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_OBJECT_OPTIONS, runObjectOp, type ObjectOp, type ObjectOpOptions, type ObjectOpResult, type Outcome } from '@/engines/json-tools/tasks'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useTask } from '@/hooks/useTask'
import { useWorker } from '@/hooks/useWorker'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { CodeEditorHandle, EditorMarker } from '@/components/editors/CodeEditor'
import { InputEditorPane, OutputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDuration } from '@/utils/format'
import { byteSize } from '../tree-viewer/values'
import ToolWorker from './worker.ts?worker'
import type { Tasks } from './worker'
import { CompareView } from './CompareView'
import { FLAT_SAMPLE, SAMPLE_A, SAMPLE_B } from './samples'

const WORKER_THRESHOLD = 300_000

interface OpInfo {
  value: ObjectOp
  label: string
  description: string
  two?: boolean
  /** Output is JSON (vs. plain text). */
  json: boolean
}

const OPS: { label: string; options: OpInfo[] }[] = [
  {
    label: 'Reshape',
    options: [
      { value: 'flatten', label: 'Flatten', description: 'Nested objects → single-level keys like user.address.city', json: true },
      { value: 'unflatten', label: 'Unflatten', description: 'Dotted / bracketed keys → nested objects and arrays', json: true },
      { value: 'sort', label: 'Sort keys', description: 'Sort object keys at every level; arrays keep their order', json: true },
    ],
  },
  {
    label: 'Clean',
    options: [
      { value: 'removeNulls', label: 'Remove nulls', description: 'Drop fields whose value is null, at any depth', json: true },
      { value: 'removeEmpty', label: 'Remove empty', description: 'Drop null, "", [] and {} fields (choose which), at any depth', json: true },
    ],
  },
  {
    label: 'Extract',
    options: [
      { value: 'keys', label: 'Extract keys', description: 'Every distinct key path, one per line (array items as [])', json: false },
      { value: 'values', label: 'Extract values', description: 'All leaf values (strings, numbers, booleans, nulls) in document order', json: true },
    ],
  },
  {
    label: 'Combine',
    options: [
      { value: 'merge', label: 'Merge objects', description: 'Deep-merge B into A — B wins on conflicts', two: true, json: true },
      { value: 'compare', label: 'Compare structure', description: 'Key paths only in A, only in B, or with a different type', two: true, json: false },
    ],
  },
]

const ALL_OPS = OPS.flatMap((g) => g.options)

const DELIMS = [
  { value: '.', label: '. dot' },
  { value: '/', label: '/ slash' },
  { value: '_', label: '_ underscore' },
  { value: '__', label: '__ double' },
  { value: ':', label: ': colon' },
  { value: 'custom', label: 'Custom…' },
]

export default function ObjectUtilities() {
  const [a, setA] = usePersistentState('input', '')
  const [b, setB] = usePersistentState('inputB', '')
  const [op, setOp] = usePersistentState<ObjectOp>('op', 'flatten')
  const [opts, setOpts] = usePersistentState<ObjectOpOptions>('options', DEFAULT_OBJECT_OPTIONS)
  const [customDelim, setCustomDelim] = usePersistentState('customDelimiter', '->')
  const [delimChoice, setDelimChoice] = usePersistentState('delimiterChoice', '.')
  const [tab, setTab] = useState<'a' | 'b' | 'out'>('a')
  const isMobile = useIsMobile()
  const aRef = useRef<CodeEditorHandle>(null)
  const bRef = useRef<CodeEditorHandle>(null)
  const worker = useWorker<Tasks>(() => new ToolWorker({ name: 'json-object-utils' }))
  const task = useTask<Outcome<ObjectOpResult>>()

  useIncomingInput(setA)

  const info = ALL_OPS.find((o) => o.value === op) ?? ALL_OPS[0]
  const delimiter = delimChoice === 'custom' ? customDelim : delimChoice
  const o: ObjectOpOptions = useMemo(() => ({ ...DEFAULT_OBJECT_OPTIONS, ...opts, empty: { ...DEFAULT_OBJECT_OPTIONS.empty, ...opts.empty }, delimiter }), [opts, delimiter])
  const set = (patch: Partial<ObjectOpOptions>) => setOpts({ ...opts, ...patch })

  const dA = useDebouncedValue(a, adaptiveDelay(a.length))
  const dB = useDebouncedValue(b, adaptiveDelay(b.length))

  useEffect(() => {
    if (!dA.trim() || (info.two && !dB.trim())) {
      task.reset()
      return
    }
    if (!o.delimiter && (op === 'flatten' || op === 'unflatten' || op === 'keys')) {
      task.reset()
      return
    }
    const payload = { op, text: dA, text2: info.two ? dB : undefined, options: o }
    void task.run((signal) => (dA.length + (info.two ? dB.length : 0) > WORKER_THRESHOLD ? worker.run('runObjectOp', payload, signal) : runObjectOp(payload)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dA, dB, op, o])

  const outcome = task.result
  const result = outcome?.ok ? outcome.value : null
  const error = task.error ? { message: task.error.message } : outcome && !outcome.ok ? outcome.error : null
  const output = result?.output ?? ''
  const stale = a !== dA || (info.two && b !== dB) || task.running

  const markersA = useMemo<EditorMarker[] | undefined>(() => (error && 'line' in error && error.line && error.source !== 'second' ? [{ message: error.message, line: error.line, column: error.column ?? 1 }] : undefined), [error])
  const markersB = useMemo<EditorMarker[] | undefined>(() => (error && 'line' in error && error.line && error.source === 'second' ? [{ message: error.message, line: error.line, column: error.column ?? 1 }] : undefined), [error])

  const replace = (ref: React.RefObject<CodeEditorHandle | null>, setter: (v: string) => void, text: string) => {
    if (ref.current?.editor) ref.current.replaceAll(text)
    else setter(text)
  }

  const useAsInput = () => {
    if (!output || !info.json) return
    replace(aRef, setA, output)
    toast.message('Output moved to input A', { description: 'Undo with Ctrl/⌘+Z in the input editor.' })
  }

  const loadSamples = () => {
    replace(aRef, setA, op === 'unflatten' ? FLAT_SAMPLE : SAMPLE_A)
    if (info.two) replace(bRef, setB, SAMPLE_B)
  }

  const optionsBar = (() => {
    const delimField = (
      <ToolbarField label="Delimiter">
        <Select aria-label="Delimiter" value={delimChoice} onValueChange={setDelimChoice} options={DELIMS} className="w-[118px]" />
        {delimChoice === 'custom' && <Input aria-label="Custom delimiter" value={customDelim} onChange={(e) => setCustomDelim(e.target.value)} className="mono h-7 w-16" aria-invalid={!customDelim} />}
      </ToolbarField>
    )
    switch (op) {
      case 'flatten':
        return (
          <>
            {delimField}
            <ToolbarField label="Arrays">
              <Segmented
                aria-label="Array index notation"
                value={o.arrays}
                onValueChange={(arrays) => set({ arrays })}
                options={[
                  { value: 'dot', label: `a${delimiter || '.'}0`, tooltip: 'Indices as path segments' },
                  { value: 'bracket', label: 'a[0]', tooltip: 'Indices in brackets' },
                ]}
              />
            </ToolbarField>
            <ToolbarField label="Max depth">
              <Select
                aria-label="Maximum depth"
                value={String(o.maxDepth)}
                onValueChange={(v) => set({ maxDepth: Number(v) })}
                options={[{ value: '0', label: 'Unlimited' }, ...[1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: String(d) }))]}
              />
            </ToolbarField>
          </>
        )
      case 'unflatten':
        return (
          <>
            {delimField}
            <Checkbox checked={o.numericArrays} onCheckedChange={(v) => set({ numericArrays: v === true })} label="Numeric keys → arrays" />
            <span className="shrink-0 text-xs text-subtle">Bracket indices like a[0] are always understood</span>
          </>
        )
      case 'sort':
        return (
          <>
            <Segmented
              aria-label="Order"
              value={o.sortOrder}
              onValueChange={(sortOrder) => set({ sortOrder })}
              options={[
                { value: 'asc', label: 'A → Z' },
                { value: 'desc', label: 'Z → A' },
              ]}
            />
            <Segmented
              aria-label="Collation"
              value={o.collation}
              onValueChange={(collation) => set({ collation })}
              options={[
                { value: 'natural', label: 'Natural', tooltip: 'item2 before item10, case-insensitive' },
                { value: 'codepoint', label: 'Code point', tooltip: 'Plain string order (Z before a)' },
              ]}
            />
          </>
        )
      case 'removeNulls':
        return <Checkbox checked={o.inArrays} onCheckedChange={(v) => set({ inArrays: v === true })} label="Also remove nulls inside arrays" />
      case 'removeEmpty':
        return (
          <>
            <span className="shrink-0 text-xs text-muted">Remove</span>
            <Checkbox checked={o.empty.null} onCheckedChange={(v) => set({ empty: { ...o.empty, null: v === true } })} label={<span className="mono">null</span>} />
            <Checkbox checked={o.empty.emptyString} onCheckedChange={(v) => set({ empty: { ...o.empty, emptyString: v === true } })} label={<span className="mono">""</span>} />
            <Checkbox checked={o.empty.emptyArray} onCheckedChange={(v) => set({ empty: { ...o.empty, emptyArray: v === true } })} label={<span className="mono">[]</span>} />
            <Checkbox checked={o.empty.emptyObject} onCheckedChange={(v) => set({ empty: { ...o.empty, emptyObject: v === true } })} label={<span className="mono">{'{}'}</span>} />
            <ToolbarSeparator />
            <Checkbox checked={o.cascade} onCheckedChange={(v) => set({ cascade: v === true })} label="Cascade" />
            <Checkbox checked={o.inArrays} onCheckedChange={(v) => set({ inArrays: v === true })} label="Inside arrays" />
          </>
        )
      case 'keys':
        return (
          <>
            {delimField}
            <Checkbox checked={o.collapseIndices} onCheckedChange={(v) => set({ collapseIndices: v === true })} label="Merge array items ([])" />
            <Checkbox checked={o.leavesOnly} onCheckedChange={(v) => set({ leavesOnly: v === true })} label="Leaf paths only" />
          </>
        )
      case 'values':
        return (
          <>
            <ToolbarField label="Output">
              <Segmented
                aria-label="Values output"
                value={o.valuesFormat}
                onValueChange={(valuesFormat) => set({ valuesFormat })}
                options={[
                  { value: 'json', label: 'JSON array' },
                  { value: 'lines', label: 'One per line' },
                ]}
              />
            </ToolbarField>
            <Checkbox checked={o.uniqueValues} onCheckedChange={(v) => set({ uniqueValues: v === true })} label="Unique" />
          </>
        )
      case 'merge':
        return (
          <>
            <ToolbarField label="Arrays">
              <Select
                aria-label="Array merge strategy"
                value={o.mergeArrays}
                onValueChange={(mergeArrays) => set({ mergeArrays })}
                options={[
                  { value: 'replace', label: 'Replace', description: 'B’s array replaces A’s' },
                  { value: 'concat', label: 'Concatenate', description: 'A’s items, then B’s' },
                  { value: 'index', label: 'Merge by index', description: 'Item 0 with item 0, …' },
                ]}
                className="w-36"
              />
            </ToolbarField>
            <Checkbox checked={o.skipNulls} onCheckedChange={(v) => set({ skipNulls: v === true })} label="Keep A’s value when B is null" />
          </>
        )
      case 'compare':
        return <span className="shrink-0 text-xs text-subtle">Array items are compared as one shape (path[])</span>
    }
  })()

  const showIndent = info.json && !(op === 'values' && o.valuesFormat === 'lines')

  const toolbar = (
    <Toolbar>
      <ToolbarField label="Operation">
        <Select aria-label="Operation" value={op} onValueChange={setOp} options={OPS.map((g) => ({ label: g.label, options: g.options.map((x) => ({ value: x.value, label: x.label, description: x.description })) }))} className="w-40" />
      </ToolbarField>
      <ToolbarSeparator />
      {optionsBar}
      <ToolbarSpacer />
      {showIndent && (
        <ToolbarField label="Indent">
          <Select
            aria-label="Output indentation"
            value={String(o.indent)}
            onValueChange={(v) => set({ indent: Number(v) })}
            options={[
              { value: '2', label: '2' },
              { value: '4', label: '4' },
              { value: '0', label: 'Min' },
            ]}
            className="w-16"
          />
        </ToolbarField>
      )}
      {info.json && (
        <Button variant="ghost" size="sm" onClick={useAsInput} disabled={!output || !!error}>
          <ArrowLeft /> Use as input
        </Button>
      )}
    </Toolbar>
  )

  const banner = (
    <>
      {error && (
        <ErrorDisplay
          error={{ message: error.message, line: 'line' in error ? error.line : undefined, column: 'column' in error ? error.column : undefined }}
          title={'source' in error && error.source === 'second' ? 'Input B' : info.two ? 'Input A' : undefined}
          onLocate={(l, c) => {
            const second = 'source' in error && error.source === 'second'
            if (isMobile) setTab(second ? 'b' : 'a')
            requestAnimationFrame(() => (second ? bRef : aRef).current?.revealPosition(l, c))
          }}
        />
      )}
      {!error && result?.warnings.map((w) => <ErrorDisplay key={w} severity="warning" error={w} />)}
    </>
  )

  const paneA = (
    <InputEditorPane
      ref={aRef}
      title={info.two ? 'A · Base' : 'Input'}
      value={a}
      onChange={setA}
      language="json"
      sample={op === 'unflatten' ? FLAT_SAMPLE : SAMPLE_A}
      accept=".json,application/json,text/plain"
      markers={markersA}
      placeholder={op === 'unflatten' ? 'Paste a flat object, e.g. {"user.name": "Ada", "user.tags.0": "x"}…' : 'Paste a JSON document…'}
      path="json-object-utils-a"
    />
  )

  const paneB = (
    <InputEditorPane
      ref={bRef}
      title={op === 'merge' ? 'B · Overrides' : 'B · Compare with'}
      value={b}
      onChange={setB}
      language="json"
      sample={SAMPLE_B}
      accept=".json,application/json,text/plain"
      markers={markersB}
      placeholder="Paste the second JSON document…"
      path="json-object-utils-b"
    />
  )

  const empty = (
    <EmptyState
      title={info.two ? `Paste two documents to ${op === 'merge' ? 'merge' : 'compare'} them` : `Paste JSON to ${info.label.toLowerCase()}`}
      description={info.description}
      actions={
        <Button size="sm" onClick={loadSamples}>
          {info.two ? 'Load sample A and B' : 'Load sample'}
        </Button>
      }
    />
  )

  const outPane =
    op === 'compare' ? (
      <div className="flex min-h-0 flex-1 flex-col">
        {banner}
        <CompareView diff={!error && result?.diff ? result.diff : null} empty={!a.trim() || !b.trim() ? empty : stale ? <div className="flex h-full items-center justify-center text-subtle"><Loader2 className="size-4 animate-spin" /></div> : null} />
      </div>
    ) : (
      <OutputEditorPane
        title={info.label}
        value={error ? '' : output}
        language={info.json && !(op === 'values' && o.valuesFormat === 'lines') ? 'json' : 'plaintext'}
        filename={`${op}.${info.json && !(op === 'values' && o.valuesFormat === 'lines') ? 'json' : 'txt'}`}
        meta={
          <span className="flex items-center gap-1.5">
            {stale && <Loader2 className="size-3 animate-spin" aria-label="Updating" />}
            {info.description}
          </span>
        }
        banner={banner}
        path="json-object-utils-output"
        emptyState={!a.trim() || (info.two && !b.trim()) ? empty : undefined}
      />
    )

  const status = (
    <StatusBar>
      <StatusItem label={info.two ? 'A' : 'Input'}>{formatBytes(byteSize(a))}</StatusItem>
      {info.two && <StatusItem label="B">{formatBytes(byteSize(b))}</StatusItem>}
      {result && !error && <StatusItem tone="accent">{result.summary}</StatusItem>}
      <StatusSpacer />
      {task.duration != null && result && <StatusItem label="Took">{formatDuration(task.duration)}</StatusItem>}
      {output && <StatusItem label="Output">{formatBytes(byteSize(output))}</StatusItem>}
      {error && <StatusItem tone="danger">Error</StatusItem>}
    </StatusBar>
  )

  if (isMobile) {
    const tabs = info.two
      ? [
          { value: 'a' as const, label: 'A' },
          { value: 'b' as const, label: 'B' },
          { value: 'out' as const, label: op === 'merge' ? 'Merged' : 'Structure' },
        ]
      : [
          { value: 'a' as const, label: 'Input' },
          { value: 'out' as const, label: 'Output' },
        ]
    const current = !info.two && tab === 'b' ? 'a' : tab
    return (
      <>
        {toolbar}
        <div className="flex shrink-0 items-center border-b border-border bg-bg px-3 py-1.5">
          <Segmented aria-label="Visible pane" value={current} onValueChange={setTab} className="w-full [&>*]:flex-1 [&>*]:justify-center" options={tabs} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{current === 'a' ? paneA : current === 'b' ? paneB : outPane}</div>
        {status}
      </>
    )
  }

  return (
    <>
      {toolbar}
      <SplitPane id="json-object-utils" initial={0.5} min={260}>
        {info.two ? (
          <SplitPane direction="vertical" id="json-object-utils-ab" initial={0.5} min={100}>
            {paneA}
            {paneB}
          </SplitPane>
        ) : (
          paneA
        )}
        {outPane}
      </SplitPane>
      {status}
    </>
  )
}
