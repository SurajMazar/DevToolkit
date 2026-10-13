import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CheckCircle2, CircleAlert, Loader2, ShieldCheck, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { DRAFTS, type DraftChoice, type SchemaError } from '@/engines/json-tools/schema'
import type { LocatedRange, Outcome, TaskError, ValidationWithLocations } from '@/engines/json-tools/tasks'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useTask } from '@/hooks/useTask'
import { useWorker } from '@/hooks/useWorker'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { CodeEditorHandle, EditorMarker } from '@/components/editors/CodeEditor'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CopyButton } from '@/components/common/CopyButton'
import { cn } from '@/utils/cn'
import { formatBytes, formatDuration, formatNumber, pluralize } from '@/utils/format'
import { byteSize } from '../tree-viewer/values'
import ToolWorker from './worker.ts?worker'
import type { Tasks } from './worker'
import { DOC_SAMPLE, SCHEMA_SAMPLE } from './sample'

/** Schema `pattern`s are user regexes; a validation that runs away is stopped. */
const TIMEOUT_MS = 8000
const ROW = 50
const MAX_MARKERS = 500

type Tab = 'document' | 'schema' | 'results'

interface InferOptions {
  required: boolean
  strict: boolean
  formats: boolean
}

function runWithTimeout<T>(exec: (s: AbortSignal) => Promise<T>, outer: AbortSignal, ms: number, what: string): Promise<T> {
  const ctrl = new AbortController()
  const relay = () => ctrl.abort()
  outer.addEventListener('abort', relay, { once: true })
  let timedOut = false
  const t = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, ms)
  return exec(ctrl.signal)
    .catch((e) => {
      if (timedOut) throw new Error(`${what} took longer than ${ms / 1000} s and was stopped. A "pattern" in the schema may be backtracking catastrophically.`)
      throw e
    })
    .finally(() => {
      clearTimeout(t)
      outer.removeEventListener('abort', relay)
    })
}

function pointerLabel(p: string) {
  return p === '' ? '(root)' : p
}

function ErrorRow({ e, loc, top, onPick }: { e: SchemaError; loc?: LocatedRange; top: number; onPick: (e: SchemaError) => void }) {
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onPick(e)}
      onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onPick(e))}
      className="group absolute left-0 flex w-full cursor-default items-start gap-2.5 border-b border-border/60 px-3 py-[7px] outline-none hover:bg-surface-2/60 focus-visible:bg-surface-2"
      style={{ top, height: ROW }}
    >
      <CircleAlert className={cn('mt-0.5 size-3.5 shrink-0', e.summary ? 'text-subtle' : 'text-danger')} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="mono max-w-[45%] shrink-0 truncate text-xs text-accent-text" title={e.pointer}>
            {pointerLabel(e.pointer)}
          </span>
          <span className={cn('min-w-0 truncate text-[13px]', e.summary ? 'text-muted' : 'text-fg')} title={e.message}>
            {e.message}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs text-subtle">
          <span className="mono shrink-0 text-muted">{e.keyword}</span>
          <span aria-hidden>·</span>
          <span className="mono min-w-0 truncate" title={`#${e.schemaPath}`}>
            #{e.schemaPath}
          </span>
        </div>
      </div>
      <span className="shrink-0 pt-px text-2xs text-subtle tabular">{loc ? `Ln ${loc.line}, Col ${loc.column}` : ''}</span>
    </div>
  )
}

function ErrorList({ errors, locations, onPick }: { errors: SchemaError[]; locations: Record<string, LocatedRange>; onPick: (e: SchemaError) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: errors.length, getScrollElement: () => ref.current, estimateSize: () => ROW, overscan: 10 })
  return (
    <div ref={ref} role="table" aria-label="Validation errors" className="h-full overflow-auto">
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((it) => {
          const e = errors[it.index]
          return <ErrorRow key={it.index} e={e} loc={locations[e.pointer]} top={it.start} onPick={onPick} />
        })}
      </div>
    </div>
  )
}

export default function JsonSchemaValidator() {
  const [doc, setDoc] = usePersistentState('document', '')
  const [schema, setSchema] = usePersistentState('schema', '')
  const [draft, setDraft] = usePersistentState<DraftChoice>('draft', 'auto')
  const [showSummaries, setShowSummaries] = usePersistentState('summaries', false)
  const [infer, setInfer] = usePersistentState<InferOptions>('infer', { required: true, strict: false, formats: true })
  const [tab, setTab] = useState<Tab>('document')
  const isMobile = useIsMobile()
  const docRef = useRef<CodeEditorHandle>(null)
  const schemaRef = useRef<CodeEditorHandle>(null)
  const worker = useWorker<Tasks>(() => new ToolWorker({ name: 'json-schema' }))
  const genWorker = useWorker<Tasks>(() => new ToolWorker({ name: 'json-schema-infer' }))
  const task = useTask<Outcome<ValidationWithLocations>>()

  useIncomingInput(setDoc)

  const dDoc = useDebouncedValue(doc, adaptiveDelay(doc.length) + 80)
  const dSchema = useDebouncedValue(schema, adaptiveDelay(schema.length) + 80)

  useEffect(() => {
    if (!dDoc.trim() || !dSchema.trim()) {
      task.reset()
      return
    }
    void task.run((signal) => runWithTimeout((s) => worker.run('runSchemaValidation', { doc: dDoc, schema: dSchema, draft }, s), signal, TIMEOUT_MS, 'Validation'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dDoc, dSchema, draft])

  const outcome = task.result
  const result = outcome?.ok ? outcome.value : null
  const error: TaskError | null = task.error ? { message: task.error.message, source: 'schema' } : outcome && !outcome.ok ? outcome.error : null
  const stale = doc !== dDoc || schema !== dSchema || task.running

  const shown = useMemo(() => (result ? (showSummaries ? result.errors : result.errors.filter((e) => !e.summary)) : []), [result, showSummaries])
  const summaryCount = result ? result.errors.length - result.errors.filter((e) => !e.summary).length : 0

  const docMarkers = useMemo<EditorMarker[] | undefined>(() => {
    if (error?.source === 'document' && error.line) return [{ message: error.message, line: error.line, column: error.column ?? 1 }]
    if (!result || error) return undefined
    const out: EditorMarker[] = []
    for (const e of shown) {
      const l = result.locations[e.pointer]
      if (!l) continue
      const onKey = l.keyLine != null && /Properties$|propertyNames/.test(e.keyword)
      const multiLine = l.endLine !== l.line
      out.push({
        message: `${e.message}  [${e.keyword} · #${e.schemaPath}]`,
        severity: e.summary ? 'warning' : 'error',
        line: onKey ? l.keyLine! : l.line,
        column: onKey ? l.keyColumn! : l.column,
        endLine: onKey ? l.keyLine : multiLine ? l.line : l.endLine,
        endColumn: onKey ? undefined : multiLine ? l.column + 1 : l.endColumn,
      })
      if (out.length >= MAX_MARKERS) break
    }
    return out
  }, [result, shown, error])

  const schemaMarkers = useMemo<EditorMarker[] | undefined>(() => (error?.source === 'schema' && error.line ? [{ message: error.message, line: error.line, column: error.column ?? 1 }] : undefined), [error])

  const jumpTo = (e: SchemaError) => {
    const l = result?.locations[e.pointer]
    const ed = docRef.current?.editor
    if (!l || !ed) return
    if (isMobile) setTab('document')
    const range = { startLineNumber: l.line, startColumn: l.column, endLineNumber: l.endLine, endColumn: l.endColumn }
    // Let the tab switch render the editor before selecting.
    requestAnimationFrame(() => {
      ed.setSelection(range)
      ed.revealRangeInCenterIfOutsideViewport(range)
      ed.focus()
    })
  }

  const setEditor = (ref: React.RefObject<CodeEditorHandle | null>, setter: (v: string) => void, text: string) => {
    if (ref.current?.editor) ref.current.replaceAll(text)
    else setter(text)
  }

  const loadExample = () => {
    setEditor(docRef, setDoc, DOC_SAMPLE)
    setEditor(schemaRef, setSchema, SCHEMA_SAMPLE)
  }

  const generate = async () => {
    if (!doc.trim()) {
      toast.error('Paste a document first — the schema is inferred from it')
      return
    }
    try {
      const r = await genWorker.run('generateSchema', { doc, ...infer })
      if (!r.ok) {
        toast.error('The document is not valid JSON', { description: `${r.error.message} (line ${r.error.line}, column ${r.error.column})` })
        return
      }
      setEditor(schemaRef, setSchema, r.value + '\n')
      if (isMobile) setTab('schema')
      toast.success('Schema generated from the document', { description: schema.trim() ? 'The previous schema was replaced — undo with Ctrl/⌘+Z in the schema editor.' : 'Tighten it with formats, patterns and limits as needed.' })
    } catch (e) {
      toast.error(String((e as Error).message ?? e))
    }
  }

  const draftLabel = result ? (DRAFTS.find((d) => d.value === result.draft)?.label ?? result.draft) : null

  const toolbar = (
    <Toolbar>
      <ToolbarField label="Draft">
        <Select aria-label="JSON Schema draft" value={draft} onValueChange={setDraft} options={DRAFTS.map((d) => ({ value: d.value, label: d.label }))} className="w-36" />
      </ToolbarField>
      {draft === 'auto' && result && (
        <span className="shrink-0 text-xs text-subtle" title={result.draftNote}>
          Using <span className="text-muted">{draftLabel}</span>
          {result.draftNote && !/^No \$schema/.test(result.draftNote) ? ` — ${result.draftNote}` : ''}
        </span>
      )}
      <ToolbarSeparator />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm">
            <Wand2 /> Generate schema
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <p className="text-sm font-medium">Infer a schema from the document</p>
          <p className="mb-3 mt-0.5 text-xs text-muted">Draft 2020-12. Array items are merged across elements; keys missing from some elements are not required.</p>
          <div className="flex flex-col gap-2.5">
            <Checkbox checked={infer.required} onCheckedChange={(v) => setInfer({ ...infer, required: v === true })} label="Mark keys present everywhere as required" />
            <Checkbox checked={infer.strict} onCheckedChange={(v) => setInfer({ ...infer, strict: v === true })} label="Disallow extra properties" description="additionalProperties: false" />
            <Checkbox checked={infer.formats} onCheckedChange={(v) => setInfer({ ...infer, formats: v === true })} label="Detect string formats" description="date-time, date, email, uuid, uri" />
          </div>
          <PopoverClose asChild>
            <Button variant="primary" size="sm" className="mt-3.5 w-full" onClick={generate} disabled={!doc.trim()}>
              <Wand2 /> {schema.trim() ? 'Replace schema' : 'Generate'}
            </Button>
          </PopoverClose>
        </PopoverContent>
      </Popover>
      <ToolbarSeparator />
      <Checkbox checked={showSummaries} onCheckedChange={(v) => setShowSummaries(v === true)} label="Show summary errors" />
      <ToolbarSpacer />
      {result && !error && (result.valid ? <Badge tone="ok">Valid</Badge> : <Badge tone="danger">{pluralize(result.errors.length - summaryCount || result.errors.length, 'error')}</Badge>)}
    </Toolbar>
  )

  const documentPane = (
    <InputEditorPane
      ref={docRef}
      title="Document"
      value={doc}
      onChange={setDoc}
      language="json"
      sample={DOC_SAMPLE}
      sampleLabel="Load sample document"
      accept=".json,application/json,text/plain"
      markers={docMarkers}
      placeholder="Paste the JSON document to validate…"
      path="json-schema-document"
    />
  )

  const schemaPane = (
    <InputEditorPane
      ref={schemaRef}
      title="Schema"
      value={schema}
      onChange={setSchema}
      language="json"
      sample={SCHEMA_SAMPLE}
      sampleLabel="Load sample schema"
      accept=".json,application/json,application/schema+json,text/plain"
      markers={schemaMarkers}
      placeholder="Paste a JSON Schema — or generate one from the document…"
      path="json-schema-schema"
    />
  )

  let body: React.ReactNode
  if (!doc.trim() || !schema.trim()) {
    body = (
      <EmptyState
        icon={<ShieldCheck />}
        title={!doc.trim() && !schema.trim() ? 'Paste a document and a schema to validate' : !doc.trim() ? 'Paste the document to validate' : 'Add a schema — paste one or generate it'}
        description="Validation runs as you type. Each error links to the exact spot in the document."
        actions={
          <>
            <Button size="sm" onClick={loadExample}>
              Load example
            </Button>
            {doc.trim() && !schema.trim() && (
              <Button size="sm" variant="ghost" onClick={generate}>
                <Wand2 /> Generate from document
              </Button>
            )}
          </>
        }
      />
    )
  } else if (error) {
    const target = error.source === 'document' ? docRef : schemaRef
    body = (
      <ErrorDisplay
        title={error.source === 'document' ? 'Document is not valid JSON' : error.line ? 'Schema is not valid JSON' : 'Schema problem'}
        error={{ message: error.message, line: error.line, column: error.column }}
        onLocate={(l, c) => {
          if (isMobile) setTab(error.source === 'document' ? 'document' : 'schema')
          requestAnimationFrame(() => target.current?.revealPosition(l, c))
        }}
        className="border-b-0"
      />
    )
  } else if (result?.valid) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <CheckCircle2 className="size-6 text-ok" />
        <p className="text-sm font-medium">The document is valid</p>
        <p className="text-sm text-muted">It satisfies every constraint in the schema ({draftLabel}).</p>
      </div>
    )
  } else if (result) {
    body = shown.length ? (
      <ErrorList errors={shown} locations={result.locations} onPick={jumpTo} />
    ) : (
      <EmptyState compact title="Only summary errors were reported" description="Turn on “Show summary errors” to list them." />
    )
  } else {
    body = (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Validating…
      </div>
    )
  }

  const resultsPane = (
    <Pane aria-label="Validation results">
      <PaneHeader
        title="Results"
        meta={
          result && !error ? (
            <span className="flex items-center gap-1.5">
              {stale && <Loader2 className="size-3 animate-spin" aria-label="Updating" />}
              {result.valid ? 'No errors' : `${pluralize(shown.length, 'error')}${!showSummaries && summaryCount ? ` · ${formatNumber(summaryCount)} summary hidden` : ''}`}
              {!result.locatedAll && ' · some locations not mapped'}
            </span>
          ) : stale && doc && schema ? (
            <Loader2 className="size-3 animate-spin" aria-label="Updating" />
          ) : undefined
        }
        actions={
          <CopyButton
            showLabel
            size="xs"
            label="Copy report"
            tooltip="Copy the error list as JSON"
            disabled={!result || result.valid}
            value={() => JSON.stringify(shown.map((e) => ({ instancePath: e.pointer, keyword: e.keyword, schemaPath: '#' + e.schemaPath, message: e.message, line: result?.locations[e.pointer]?.line })), null, 2)}
          />
        }
      />
      <div className="relative min-h-0 flex-1">{body}</div>
    </Pane>
  )

  const status = (
    <StatusBar>
      <StatusItem label="Document">{formatBytes(byteSize(doc))}</StatusItem>
      <StatusItem label="Schema">{formatBytes(byteSize(schema))}</StatusItem>
      {result && <StatusItem label="Draft">{draftLabel}</StatusItem>}
      <StatusSpacer />
      {task.duration != null && result && <StatusItem label="Validated in">{formatDuration(task.duration)}</StatusItem>}
      {error ? <StatusItem tone="danger">{error.source === 'document' ? 'Invalid document JSON' : 'Schema error'}</StatusItem> : result ? result.valid ? <StatusItem tone="ok">Valid</StatusItem> : <StatusItem tone="danger">Invalid</StatusItem> : null}
    </StatusBar>
  )

  if (isMobile) {
    return (
      <>
        {toolbar}
        <div className="flex shrink-0 items-center border-b border-border bg-bg px-3 py-1.5">
          <Segmented
            aria-label="Visible pane"
            value={tab}
            onValueChange={setTab}
            className="w-full [&>*]:flex-1 [&>*]:justify-center"
            options={[
              { value: 'document', label: 'Document' },
              { value: 'schema', label: 'Schema' },
              { value: 'results', label: result && !result.valid && !error ? `Results (${shown.length})` : 'Results' },
            ]}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{tab === 'document' ? documentPane : tab === 'schema' ? schemaPane : resultsPane}</div>
        {status}
      </>
    )
  }

  return (
    <>
      {toolbar}
      <div className="flex min-h-0 flex-1 flex-col">
        <SplitPane direction="vertical" id="json-schema-v" initial={0.64} min={120}>
          <SplitPane id="json-schema-h" initial={0.5} min={240}>
            {documentPane}
            {schemaPane}
          </SplitPane>
          {resultsPane}
        </SplitPane>
      </div>
      {status}
    </>
  )
}
