import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, FileCode2, ListTree, Loader2, MoreHorizontal } from 'lucide-react'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane, OutputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput, useSendToTool } from '@/hooks/useIncomingInput'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { useDebouncedValue } from '@/hooks/useDebounced'
import { createJsonWorker } from '@/workers/factories'
import { formatJson, type FormatPayload, type FormatResult, type JsonTasks } from '@/workers/json.tasks'
import { formatBytes, formatDuration, formatNumber } from '@/utils/format'

const SAMPLE = `{"service":"billing-api","version":"2.14.0","healthy":true,"uptimeSeconds":864213,"region":null,
"instances":[{"id":"i-0a1b2c","zone":"eu-west-1a","cpu":0.42,"memoryMb":1536,"tags":["primary","blue"]},
{"id":"i-3d4e5f","zone":"eu-west-1b","cpu":0.17,"memoryMb":1536,"tags":["replica"]}],
"limits":{"requestsPerMinute":6000,"burst":250,"invoiceIdMax":9223372036854775807},
"features":{"proration":true,"multiCurrency":{"enabled":true,"currencies":["EUR","GBP","USD"]}}}`

/** Main-thread formatting below this size; worker above. */
const SYNC_LIMIT = 300_000

interface Settings {
  mode: FormatPayload['mode']
  indent: '2' | '4' | 'tab'
  sortKeys: 'none' | 'asc' | 'desc'
  asciiOnly: boolean
  jsonc: boolean
}

const DEFAULTS: Settings = { mode: 'beautify', indent: '2', sortKeys: 'none', asciiOnly: false, jsonc: false }

export default function JsonFormatter() {
  const [input, setInput] = usePersistentState('input', '')
  const [s, setS] = usePersistentState<Settings>('settings', DEFAULTS)
  const settings = { ...DEFAULTS, ...s }
  const set = (patch: Partial<Settings>) => setS({ ...settings, ...patch })
  const inputRef = useRef<CodeEditorHandle>(null)
  const outputRef = useRef<CodeEditorHandle>(null)
  const worker = useWorker<JsonTasks>(createJsonWorker)
  const task = useTask<{ result: FormatResult; key: string }>()
  const send = useSendToTool()
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)

  useIncomingInput(setInput)

  const payload = useMemo(
    () => ({
      mode: settings.mode,
      indent: settings.indent === 'tab' ? '\t' : Number(settings.indent),
      sortKeys: settings.sortKeys === 'none' ? (false as const) : settings.sortKeys,
      asciiOnly: settings.asciiOnly,
      jsonc: settings.jsonc,
    }),
    [settings.mode, settings.indent, settings.sortKeys, settings.asciiOnly, settings.jsonc],
  )

  const delay = input.length < 50_000 ? 0 : input.length < 2_000_000 ? 250 : 600
  const debounced = useDebouncedValue(input, delay)
  const key = `${debounced.length}:${JSON.stringify(payload)}`

  // Small inputs format synchronously (instant); large ones in a worker with cancel.
  const sync = useMemo(() => (debounced.trim() && debounced.length <= SYNC_LIMIT ? formatJson({ text: debounced, ...payload }) : null), [debounced, payload])
  useEffect(() => {
    if (!debounced.trim() || debounced.length <= SYNC_LIMIT) {
      task.reset()
      return
    }
    const k = key
    void task.run(async (signal) => ({ result: await worker.run('formatJson', { text: debounced, ...payload }, signal), key: k }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, payload])

  const result: FormatResult | null = sync ?? (task.result?.key === key ? task.result.result : null)
  const output = result?.ok ? result.output : ''
  const error = result && !result.ok ? result.error : null

  const fold = (action: 'editor.foldAll' | 'editor.unfoldAll' | 'editor.foldLevel2' | 'editor.foldLevel3') => outputRef.current?.editor?.getAction(action)?.run()

  return (
    <>
      <Toolbar>
        <Segmented
          aria-label="Mode"
          value={settings.mode}
          onValueChange={(mode) => set({ mode })}
          options={[
            { value: 'beautify', label: 'Beautify' },
            { value: 'minify', label: 'Minify' },
          ]}
        />
        <ToolbarSeparator />
        {settings.mode === 'beautify' && (
          <ToolbarField label="Indent">
            <Select
              aria-label="Indentation"
              value={settings.indent}
              onValueChange={(indent) => set({ indent })}
              options={[
                { value: '2', label: '2 spaces' },
                { value: '4', label: '4 spaces' },
                { value: 'tab', label: 'Tabs' },
              ]}
            />
          </ToolbarField>
        )}
        <ToolbarField label="Sort keys">
          <Select
            aria-label="Sort keys"
            value={settings.sortKeys}
            onValueChange={(sortKeys) => set({ sortKeys })}
            options={[
              { value: 'none', label: 'Keep order' },
              { value: 'asc', label: 'A → Z' },
              { value: 'desc', label: 'Z → A' },
            ]}
          />
        </ToolbarField>
        <Checkbox checked={settings.jsonc} onCheckedChange={(v) => set({ jsonc: v === true })} label="Allow comments & trailing commas" />
        <Checkbox checked={settings.asciiOnly} onCheckedChange={(v) => set({ asciiOnly: v === true })} label="Escape non-ASCII" />
        <ToolbarSpacer />
        <IconButton label="Collapse all" icon={<ChevronsDownUp />} onClick={() => fold('editor.foldAll')} disabled={!output || settings.mode === 'minify'} />
        <IconButton label="Expand all" icon={<ChevronsUpDown />} onClick={() => fold('editor.unfoldAll')} disabled={!output || settings.mode === 'minify'} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={!output}>
              <MoreHorizontal /> Open in
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => send('/json/tree', output)}>
              <ListTree /> JSON Tree Viewer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => send('/json/to-typescript', output)}>
              <FileCode2 /> JSON to TypeScript
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Toolbar>
      {error && (
        <ErrorDisplay
          title="Invalid JSON"
          error={error}
          onLocate={(l, c) => {
            setMobileTab(0)
            setTimeout(() => inputRef.current?.revealPosition(l, c), 30)
          }}
          action={
            !settings.jsonc && /comment|trailing|Unexpected token .*[/,]|found "[/,\]}]"/i.test(error.message + input.slice(Math.max(0, error.offset - 1), error.offset + 1)) ? (
              <Button size="xs" variant="ghost" className="-my-0.5" onClick={() => set({ jsonc: true })}>
                Allow comments & trailing commas
              </Button>
            ) : undefined
          }
        />
      )}
      <SplitPane id="json-formatter" mobileTabs={['Input', 'Formatted']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        <InputEditorPane
          ref={inputRef}
          value={input}
          onChange={setInput}
          language="json"
          path="json-formatter-input.json"
          accept=".json,.jsonc,application/json"
          sample={SAMPLE}
          markers={error ? [{ message: error.message, line: error.line, column: error.column }] : undefined}
          emptyState={
            <EmptyState
              compact
              title="Paste JSON to format, minify or validate it."
              description="Errors are pinpointed by line and column. Large integers keep every digit."
              actions={<Button onClick={() => (inputRef.current?.editor ? inputRef.current.replaceAll(SAMPLE) : setInput(SAMPLE))}>Load sample</Button>}
            />
          }
        />
        <OutputEditorPane
          ref={outputRef}
          title={settings.mode === 'minify' ? 'Minified' : 'Formatted'}
          value={output}
          language="json"
          path="json-formatter-output.json"
          filename={settings.mode === 'minify' ? 'formatted.min.json' : 'formatted.json'}
          mime="application/json"
          meta={task.running ? <Loader2 className="size-3 animate-spin" /> : undefined}
          emptyState={!input.trim() ? <EmptyState compact title="Formatted output appears here" /> : undefined}
        />
      </SplitPane>
      <StatusBar>
        {result?.ok ? (
          <>
            <StatusItem tone="ok">Valid JSON</StatusItem>
            <StatusItem label="Keys">{formatNumber(result.stats.keys)}</StatusItem>
            <StatusItem label="Objects">{formatNumber(result.stats.objects)}</StatusItem>
            <StatusItem label="Arrays">{formatNumber(result.stats.arrays)}</StatusItem>
            <StatusItem label="Depth">{formatNumber(result.stats.maxDepth)}</StatusItem>
            {result.jsonc && (result.jsonc.comments > 0 || result.jsonc.trailingCommas > 0) && (
              <StatusItem tone="mod">
                Removed {result.jsonc.comments} comments, {result.jsonc.trailingCommas} trailing commas
              </StatusItem>
            )}
          </>
        ) : error ? (
          <StatusItem tone="danger">
            Error at {error.line}:{error.column}
          </StatusItem>
        ) : (
          <StatusItem>{task.running ? 'Formatting…' : 'Waiting for input'}</StatusItem>
        )}
        <StatusSpacer />
        {result?.ok && result.hasBigNumbers && <StatusItem tone="accent">Big numbers preserved</StatusItem>}
        {output && (
          <StatusItem label="Size">
            {formatBytes(input.length)} → {formatBytes(output.length)}
          </StatusItem>
        )}
        {task.duration != null && !sync && result && <StatusItem label="Took">{formatDuration(task.duration)}</StatusItem>}
      </StatusBar>
    </>
  )
}
