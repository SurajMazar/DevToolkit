import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Radar, X } from 'lucide-react'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { Pane } from '@/components/tools/Pane'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useWorker } from '@/hooks/useWorker'
import { useTask } from '@/hooks/useTask'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import type { Analysis } from '@/engines/dev/api-inspect'
import { ArraysPanel, OverviewPanel, ShapePanel } from './panels'
import { ComparePanel, PathsPanel, SearchPanel } from './query'
import { SAMPLE_A, SAMPLE_B } from './samples'
import { formatBytes, formatDuration, formatNumber, utf8Length } from '@/utils/format'
import InspectWorker from './worker.ts?worker'
import type { Tasks } from './worker'

type Tab = 'overview' | 'shape' | 'arrays' | 'search' | 'paths' | 'compare'

export default function ApiInspector() {
  const [input, setInput] = usePersistentState('input', '')
  const [inputB, setInputB] = usePersistentState('inputB', '')
  const [tab, setTab] = usePersistentState<Tab>('tab', 'overview')
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const editor = useRef<CodeEditorHandle>(null)
  const worker = useWorker<Tasks>(() => new InspectWorker({ name: 'api-inspector' }))
  const task = useTask<Analysis>()
  useIncomingInput(setInput)

  const text = useDebouncedValue(input, Math.max(150, adaptiveDelay(input.length)))
  useEffect(() => {
    if (!text.trim()) {
      task.reset()
      return
    }
    void task.run((signal) => worker.run('analyze', text, signal))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const a = text.trim() ? task.result : undefined
  const ok = a?.ok ? a : null
  const err = a && !a.ok ? a.error : null
  const textBytes = useMemo(() => utf8Length(text), [text])

  const locate = (line: number, column?: number) => {
    setMobileTab(0)
    requestAnimationFrame(() => editor.current?.revealPosition(line, column))
  }
  const loadSample = () => {
    if (editor.current?.editor) editor.current.replaceAll(SAMPLE_A)
    else setInput(SAMPLE_A)
  }

  const right = (
    <Pane aria-label="Analysis">
      {!text.trim() ? (
        <EmptyState
          icon={<Radar />}
          title="Paste a JSON API response."
          description="Raw HTTP responses work too — the status line and headers are stripped. Big integers stay exact."
          actions={<Button size="sm" onClick={loadSample}>Load sample response</Button>}
        />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="overflow-x-auto [scrollbar-width:none]">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="shape">Shape</TabsTrigger>
            <TabsTrigger value="arrays">
              Arrays {ok && <span className="text-subtle tabular">{ok.arrays.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="paths">Paths</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
          </TabsList>
          {err && <ErrorDisplay title="Invalid JSON" error={{ message: err.message, line: err.line, column: err.column }} onLocate={locate} />}
          {task.error && <ErrorDisplay error={task.error.message} action={<Button size="xs" variant="ghost" onClick={() => task.run((s) => worker.run('analyze', text, s))}>Retry</Button>} />}
          {!ok && !err && !task.error && (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" /> Analysing {formatBytes(textBytes)}…
              <Button size="xs" variant="ghost" onClick={task.cancel}>
                <X /> Cancel
              </Button>
            </div>
          )}
          {ok && (
            <>
              <TabsContent value="overview" className="flex min-h-0 flex-1 flex-col">
                <OverviewPanel a={ok} textBytes={textBytes} />
              </TabsContent>
              <TabsContent value="shape" className="flex min-h-0 flex-1 flex-col">
                <ShapePanel shape={ok.shape} />
              </TabsContent>
              <TabsContent value="arrays" className="flex min-h-0 flex-1 flex-col">
                <ArraysPanel arrays={ok.arrays} />
              </TabsContent>
              <TabsContent value="search" className="flex min-h-0 flex-1 flex-col">
                <SearchPanel text={text} />
              </TabsContent>
              <TabsContent value="paths" className="flex min-h-0 flex-1 flex-col">
                <PathsPanel text={text} />
              </TabsContent>
            </>
          )}
          {(ok || err) && (
            <TabsContent value="compare" className="flex min-h-0 flex-1 flex-col">
              <ComparePanel text={text} textB={inputB} setTextB={setInputB} sampleB={SAMPLE_B} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </Pane>
  )

  return (
    <>
      <Toolbar>
        <Button size="sm" variant="ghost" onClick={loadSample}>
          Load sample
        </Button>
        <span className="text-xs text-subtle">JSON body or a full HTTP response (headers are stripped)</span>
        <ToolbarSpacer />
        {task.running && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin" /> Analysing in background
          </span>
        )}
      </Toolbar>
      <SplitPane id="api-inspector" initial={0.42} mobileTabs={['Response', 'Analysis']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        <InputEditorPane
          ref={editor}
          title="Response"
          value={input}
          onChange={setInput}
          language={/^\s*HTTP\//.test(input) ? 'plaintext' : 'json'}
          sample={SAMPLE_A}
          accept=".json,.txt,.har,.http,application/json"
          markers={err ? [{ line: err.line, column: err.column, message: err.message }] : undefined}
          placeholder="Paste a JSON response, or HTTP/1.1 200 OK + headers + body…"
          path="api-inspector-a"
        />
        {right}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Size">{text ? formatBytes(ok ? ok.bodyBytes : textBytes) : '—'}</StatusItem>
        {ok && <StatusItem label="Nodes">{formatNumber(ok.overview.nodes)}</StatusItem>}
        {ok && <StatusItem label="Depth">{ok.overview.depth}</StatusItem>}
        {ok?.envelope && <StatusItem label="HTTP">{ok.envelope.statusLines.at(-1) ?? `${ok.envelope.headers.length} headers`}</StatusItem>}
        {err && <StatusItem tone="danger">Invalid JSON at {err.line}:{err.column}</StatusItem>}
        <StatusSpacer />
        {task.duration != null && ok && <StatusItem label="Analysed in">{formatDuration(task.duration)}</StatusItem>}
        {ok && <StatusItem tone="ok">Valid JSON</StatusItem>}
      </StatusBar>
    </>
  )
}
