import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Loader2 } from 'lucide-react'
import type { CodeEditorHandle, EditorMarker } from '@/components/editors/CodeEditor'
import { InputEditorPane, OutputEditorPane } from './EditorPane'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from './Toolbar'
import { SplitPane } from './SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from './StatusBar'
import { ErrorDisplay, type DisplayError } from './ErrorDisplay'
import { EmptyState } from './EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import { useTask } from '@/hooks/useTask'
import { formatBytes, formatDuration, utf8Length } from '@/utils/format'

export interface ConverterMode {
  value: string
  /** Label in the mode switch, e.g. "Encode". */
  label: string
  inputLabel: string
  outputLabel: string
  inputLanguage?: string
  outputLanguage?: string
  placeholder?: string
  sample?: string | (() => string)
  /** File extension for the downloaded output. */
  outputExt?: string
  /** Mode selected when the user swaps output back into the input. */
  inverse?: string
  /** Accept attribute for "Open file". */
  accept?: string
}

export interface ConverterResult {
  output: string
  error?: DisplayError | string | null
  warning?: string | null
  /** Small text shown in the output pane header. */
  meta?: React.ReactNode
  /** Extra status-bar items. */
  status?: React.ReactNode
  /** Markers to show in the input editor (e.g. parse error location). */
  markers?: EditorMarker[]
}

export type ConverterTransform = (input: string, mode: string, signal: AbortSignal) => ConverterResult | string | Promise<ConverterResult | string>

interface ConverterToolProps {
  modes: ConverterMode[]
  transform: ConverterTransform
  /** Toolbar controls specific to the tool (rendered after the mode switch). */
  options?: React.ReactNode
  /** Changes to this value re-run the transform (serialize your option state into it). */
  optionsKey?: unknown
  defaultMode?: string
  /** Shown in the output pane when there is no input. */
  emptyTitle?: string
  emptyDescription?: string
  /** Extra actions in the output pane header. */
  outputActions?: (output: string, input: string, result: ConverterResult) => React.ReactNode
  /** Replace the output editor entirely (e.g. a preview). Receives the current result. */
  renderOutput?: (result: ConverterResult, mode: ConverterMode) => React.ReactNode
  /** Initial ratio of the input pane. */
  split?: number
  /** Persist under a specific key prefix (when a tool has several converters). */
  persistPrefix?: string
  /** Let the output editor be edited (e.g. to tweak before copying). */
  outputEditable?: boolean
  inputWordWrap?: boolean
  /** Empty state shown over the input editor. */
  inputEmptyState?: React.ReactNode
  outputWordWrap?: boolean
  onModeChange?: (mode: string) => void
}

/**
 * Shared layout for two-way text converters (Base64, URL, YAML⇄JSON…): mode switch,
 * live transform with size-adaptive debouncing, explicit errors, swap, copy/download.
 */
export function ConverterTool({
  modes,
  transform,
  options,
  optionsKey,
  defaultMode,
  emptyTitle,
  emptyDescription,
  outputActions,
  renderOutput,
  split = 0.5,
  persistPrefix = '',
  outputEditable,
  inputWordWrap,
  inputEmptyState,
  outputWordWrap,
  onModeChange,
}: ConverterToolProps) {
  const [input, setInput] = usePersistentState(`${persistPrefix}input`, '')
  const [modeValue, setModeValue] = usePersistentState(`${persistPrefix}mode`, defaultMode ?? modes[0].value)
  const mode = modes.find((m) => m.value === modeValue) ?? modes[0]
  const inputRef = useRef<CodeEditorHandle>(null)
  const debounced = useDebouncedValue(input, adaptiveDelay(input.length))
  const task = useTask<ConverterResult>()
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const transformRef = useRef(transform)
  transformRef.current = transform

  useIncomingInput(setInput)

  useEffect(() => {
    onModeChange?.(mode.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.value])

  const optionsSig = useMemo(() => JSON.stringify(optionsKey ?? null), [optionsKey])

  useEffect(() => {
    if (!debounced) {
      task.reset()
      return
    }
    void task.run(async (signal) => {
      const r = await transformRef.current(debounced, mode.value, signal)
      return typeof r === 'string' ? { output: r } : r
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, mode.value, optionsSig])

  const result: ConverterResult = task.error ? { output: '', error: task.error.message } : (task.result ?? { output: '' })
  const output = debounced ? result.output : ''
  const stale = input !== debounced

  const setMode = (v: string) => setModeValue(v)

  const swap = () => {
    const next = mode.inverse ?? modes.find((m) => m.value !== mode.value)?.value
    if (inputRef.current?.editor) inputRef.current.replaceAll(output)
    else setInput(output)
    if (next) setMode(next)
  }

  const banner = (
    <>
      {result.error && <ErrorDisplay error={result.error} onLocate={(l, c) => inputRef.current?.revealPosition(l, c)} />}
      {!result.error && result.warning && <ErrorDisplay severity="warning" error={result.warning} />}
    </>
  )

  const inputPane = (
    <InputEditorPane
      ref={inputRef}
      title={mode.inputLabel}
      value={input}
      onChange={setInput}
      language={mode.inputLanguage}
      placeholder={mode.placeholder}
      sample={mode.sample}
      accept={mode.accept}
      markers={result.markers}
      wordWrap={inputWordWrap}
      emptyState={inputEmptyState}
      path={`${persistPrefix}converter-input`}
    />
  )

  const outputPane = renderOutput ? (
    <div className="flex min-h-0 flex-1 flex-col">
      {banner}
      {renderOutput(result, mode)}
    </div>
  ) : (
    <OutputEditorPane
      title={mode.outputLabel}
      value={output}
      language={mode.outputLanguage}
      filename={`output.${mode.outputExt ?? 'txt'}`}
      meta={
        <span className="flex items-center gap-2">
          {(task.running || stale) && <Loader2 className="size-3 animate-spin" aria-label="Updating" />}
          {result.meta}
        </span>
      }
      actions={outputActions?.(output, debounced, result)}
      banner={banner}
      editable={outputEditable}
      wordWrap={outputWordWrap}
      path={`${persistPrefix}converter-output`}
      emptyState={
        !input ? <EmptyState compact title={emptyTitle ?? `Paste ${/^[A-Z][a-z]/.test(mode.inputLabel) && !/[A-Z]{2}/.test(mode.inputLabel) ? mode.inputLabel.toLowerCase() : mode.inputLabel} to convert it.`} description={emptyDescription} /> : undefined
      }
    />
  )

  const inBytes = useMemo(() => (debounced.length < 5_000_000 ? utf8Length(debounced) : debounced.length), [debounced])
  const outBytes = useMemo(() => (output.length < 5_000_000 ? utf8Length(output) : output.length), [output])

  return (
    <>
      <Toolbar>
        {modes.length > 1 && (
          <Segmented aria-label="Direction" value={mode.value} onValueChange={setMode} options={modes.map((m) => ({ value: m.value, label: m.label }))} />
        )}
        {options && (
          <>
            {modes.length > 1 && <ToolbarSeparator />}
            {options}
          </>
        )}
        <ToolbarSpacer />
        {modes.length > 1 && (
          <Button variant="ghost" size="sm" onClick={swap} disabled={!output || !!result.error}>
            <ArrowLeftRight /> Swap
          </Button>
        )}
      </Toolbar>
      <SplitPane id={`${persistPrefix}converter`} initial={split} mobileTabs={[mode.inputLabel, mode.outputLabel]} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        {inputPane}
        {outputPane}
      </SplitPane>
      <StatusBar>
        <StatusItem label={mode.inputLabel}>{formatBytes(inBytes)}</StatusItem>
        <StatusItem label={mode.outputLabel}>{output ? formatBytes(outBytes) : '—'}</StatusItem>
        {output && inBytes > 0 && <StatusItem label="Ratio">{((outBytes / inBytes) * 100).toFixed(outBytes / inBytes < 0.1 ? 1 : 0)}%</StatusItem>}
        {result.status}
        <StatusSpacer />
        {task.duration != null && !!output && <StatusItem label="Took">{formatDuration(task.duration)}</StatusItem>}
        {result.error && <StatusItem tone="danger">Error</StatusItem>}
      </StatusBar>
    </>
  )
}
