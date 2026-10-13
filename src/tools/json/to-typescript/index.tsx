import { useEffect, useMemo, useRef } from 'react'
import { Loader2, Settings2 } from 'lucide-react'
import { generateTypes, type Outcome } from '@/engines/json-tools/tasks'
import type { TsOptions } from '@/engines/json-tools/typescript'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useTask } from '@/hooks/useTask'
import { useWorker } from '@/hooks/useWorker'
import type { CodeEditorHandle, EditorMarker } from '@/components/editors/CodeEditor'
import { InputEditorPane, OutputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/utils/cn'
import { countLines, formatBytes, formatDuration, formatNumber } from '@/utils/format'
import { byteSize } from '../tree-viewer/values'
import ToolWorker from './worker.ts?worker'
import type { Tasks } from './worker'
import { TS_SAMPLE } from './sample'

const WORKER_THRESHOLD = 400_000

type Format = 'typescript' | 'zod'

interface UiOptions {
  rootName: string
  declaration: 'interface' | 'type'
  export: boolean
  readonly: boolean
  nulls: 'union' | 'optional'
  propertyNames: 'keep' | 'camel'
  dedupe: boolean
  bigNumbers: 'number' | 'string-number' | 'bigint'
  arraySyntax: 'brackets' | 'generic'
}

const DEFAULT_UI: UiOptions = {
  rootName: 'Root',
  declaration: 'interface',
  export: true,
  readonly: false,
  nulls: 'union',
  propertyNames: 'keep',
  dedupe: true,
  bigNumbers: 'number',
  arraySyntax: 'brackets',
}

export default function JsonToTypeScript() {
  const [input, setInput] = usePersistentState('input', '')
  const [format, setFormat] = usePersistentState<Format>('format', 'typescript')
  const [stored, setUi] = usePersistentState<UiOptions>('options', DEFAULT_UI)
  const ui = useMemo(() => ({ ...DEFAULT_UI, ...stored }), [stored])
  const set = (patch: Partial<UiOptions>) => setUi({ ...ui, ...patch })
  const inputRef = useRef<CodeEditorHandle>(null)
  const worker = useWorker<Tasks>(() => new ToolWorker({ name: 'json-to-ts' }))
  const task = useTask<Awaited<ReturnType<typeof generateTypes>>>()

  useIncomingInput(setInput)

  const debounced = useDebouncedValue(input, adaptiveDelay(input.length))
  const options: TsOptions = useMemo(() => ({ ...ui, rootName: ui.rootName.trim() || 'Root' }), [ui])

  useEffect(() => {
    if (!debounced.trim()) {
      task.reset()
      return
    }
    const payload = { text: debounced, format, options }
    void task.run((signal) => (debounced.length > WORKER_THRESHOLD ? worker.run('generateTypes', payload, signal) : generateTypes(payload)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, format, options])

  const outcome: Outcome<{ code: string; declarations: number; hasBigNumbers: boolean }> | undefined = task.result
  const result = outcome?.ok ? outcome.value : null
  const error = task.error ? { message: task.error.message } : outcome && !outcome.ok ? outcome.error : null
  const code = error ? '' : (result?.code ?? '')
  const stale = input !== debounced || task.running
  const markers = useMemo<EditorMarker[] | undefined>(() => (error && 'line' in error && error.line ? [{ message: error.message, line: error.line, column: error.column ?? 1 }] : undefined), [error])

  const advancedActive = ui.readonly || ui.propertyNames !== 'keep' || !ui.dedupe || ui.bigNumbers !== 'number' || ui.arraySyntax !== 'brackets' || !ui.export

  const toolbar = (
    <Toolbar>
      <Segmented
        aria-label="Output format"
        value={format}
        onValueChange={setFormat}
        options={[
          { value: 'typescript', label: 'TypeScript' },
          { value: 'zod', label: 'Zod', tooltip: 'Zod schemas plus z.infer types' },
        ]}
      />
      <ToolbarSeparator />
      <ToolbarField label="Root">
        <Input aria-label="Root type name" value={ui.rootName} onChange={(e) => set({ rootName: e.target.value })} className="mono h-7 w-28" placeholder="Root" spellCheck={false} />
      </ToolbarField>
      {format === 'typescript' && (
        <Segmented
          aria-label="Declaration style"
          value={ui.declaration}
          onValueChange={(declaration) => set({ declaration })}
          options={[
            { value: 'interface', label: 'interface' },
            { value: 'type', label: 'type' },
          ]}
        />
      )}
      <ToolbarField label="Nullable keys">
        <Select
          aria-label="Null handling"
          value={ui.nulls}
          onValueChange={(nulls) => set({ nulls })}
          options={[
            { value: 'union', label: 'T | null', description: 'key: string | null' },
            { value: 'optional', label: 'Optional', description: format === 'zod' ? 'key: z.string().nullish()' : 'key?: string' },
          ]}
          className="w-28"
        />
      </ToolbarField>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn(advancedActive && 'text-accent-text')}>
            <Settings2 /> Options
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="flex flex-col gap-3.5">
            <Checkbox checked={ui.export} onCheckedChange={(v) => set({ export: v === true })} label="Export declarations" />
            {format === 'typescript' && <Checkbox checked={ui.readonly} onCheckedChange={(v) => set({ readonly: v === true })} label="Readonly properties" />}
            <Checkbox checked={ui.dedupe} onCheckedChange={(v) => set({ dedupe: v === true })} label="Reuse identical types" description="Objects with the same shape share one declaration" />
            {format === 'typescript' && (
              <Field label="Property names" hint={ui.propertyNames === 'camel' ? 'Renamed keys get a comment with the original key' : undefined}>
                <Segmented
                  aria-label="Property names"
                  value={ui.propertyNames}
                  onValueChange={(propertyNames) => set({ propertyNames })}
                  options={[
                    { value: 'keep', label: 'As in JSON' },
                    { value: 'camel', label: 'camelCase' },
                  ]}
                />
              </Field>
            )}
            <Field label="Integers beyond 2^53" hint="Such values lose precision with JSON.parse">
              <Select
                aria-label="Big number type"
                value={ui.bigNumbers}
                onValueChange={(bigNumbers) => set({ bigNumbers })}
                options={[
                  { value: 'number', label: 'number', description: 'With a precision warning comment' },
                  { value: 'string-number', label: 'string | number', description: 'If you keep them as strings' },
                  { value: 'bigint', label: 'bigint', description: 'For BigInt-aware parsers' },
                ]}
              />
            </Field>
            {format === 'typescript' && (
              <Field label="Array syntax">
                <Segmented
                  aria-label="Array syntax"
                  value={ui.arraySyntax}
                  onValueChange={(arraySyntax) => set({ arraySyntax })}
                  options={[
                    { value: 'brackets', label: 'T[]' },
                    { value: 'generic', label: 'Array<T>' },
                  ]}
                />
              </Field>
            )}
            {format === 'zod' && <p className="text-xs text-subtle">Zod keeps property names exactly as in the JSON so the schema can parse it.</p>}
          </div>
        </PopoverContent>
      </Popover>
      <ToolbarSpacer />
      {result?.hasBigNumbers && <Badge tone="accent">Big integers detected</Badge>}
    </Toolbar>
  )

  return (
    <>
      {toolbar}
      <SplitPane id="json-to-ts" initial={0.45} min={260} mobileTabs={['JSON', format === 'zod' ? 'Zod' : 'TypeScript']}>
        <InputEditorPane
          ref={inputRef}
          title="JSON"
          value={input}
          onChange={setInput}
          language="json"
          sample={TS_SAMPLE}
          accept=".json,application/json,text/plain"
          markers={markers}
          placeholder="Paste a JSON sample — an API response, a config file…"
          path="json-to-ts-input"
        />
        <OutputEditorPane
          title={format === 'zod' ? 'Zod schema' : 'TypeScript'}
          value={code}
          language="typescript"
          filename={format === 'zod' ? `${(ui.rootName || 'root').toLowerCase()}.schema.ts` : `${(ui.rootName || 'root').toLowerCase()}.types.ts`}
          meta={
            <span className="flex items-center gap-1.5">
              {stale && input && <Loader2 className="size-3 animate-spin" aria-label="Updating" />}
              {result && !error ? `${formatNumber(result.declarations)} ${format === 'zod' ? 'schemas' : 'declarations'}` : null}
            </span>
          }
          banner={
            error ? (
              <ErrorDisplay
                title="Invalid JSON"
                error={{ message: error.message, line: 'line' in error ? error.line : undefined, column: 'column' in error ? error.column : undefined }}
                onLocate={(l, c) => inputRef.current?.revealPosition(l, c)}
              />
            ) : null
          }
          path="json-to-ts-output"
          emptyState={
            !input.trim() ? (
              <EmptyState
                title="Paste JSON to generate types"
                description="Arrays of objects are merged — keys missing from some items become optional, nested objects get their own named types."
                actions={
                  <Button size="sm" onClick={() => (inputRef.current?.editor ? inputRef.current.replaceAll(TS_SAMPLE) : setInput(TS_SAMPLE))}>
                    Load sample API response
                  </Button>
                }
              />
            ) : undefined
          }
        />
      </SplitPane>
      <StatusBar>
        <StatusItem label="Input">{formatBytes(byteSize(input))}</StatusItem>
        {result && !error && <StatusItem label={format === 'zod' ? 'Schemas' : 'Declarations'}>{formatNumber(result.declarations)}</StatusItem>}
        {code && <StatusItem label="Lines">{formatNumber(countLines(code.trimEnd()))}</StatusItem>}
        <StatusSpacer />
        {task.duration != null && result && <StatusItem label="Took">{formatDuration(task.duration)}</StatusItem>}
        {error && <StatusItem tone="danger">Invalid JSON</StatusItem>}
      </StatusBar>
    </>
  )
}
