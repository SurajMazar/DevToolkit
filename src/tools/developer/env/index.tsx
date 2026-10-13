import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownAZ, CopyMinus, Eye, EyeOff, Info, KeyRound, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { CodeEditor } from '@/components/editors/CodeEditor'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { Pane, PaneBody, PaneHeader } from '@/components/tools/Pane'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { CopyButton } from '@/components/common/CopyButton'
import { DownloadButton } from '@/components/common/DownloadButton'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import {
  compareEnv,
  EXPORT_FORMATS,
  exportEnv,
  isSensitive,
  MASK,
  maskValue,
  parseEnv,
  SAMPLE_ENV,
  SAMPLE_ENV_B,
  toDotenv,
  type CompareStatus,
  type EnvEntry,
  type EnvIssue,
  type ExportFormat,
  type ParsedEnv,
} from '@/engines/dev/env'
import { VirtualList } from '../_shared/VirtualList'
import { cn } from '@/utils/cn'
import { pluralize } from '@/utils/format'

function useRevealSet() {
  const [set, setSet] = useState<Set<string>>(() => new Set())
  const toggle = (k: string) =>
    setSet((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  return [set, toggle] as const
}

function ValueCell({ value, masked, className }: { value: string; masked: boolean; className?: string }) {
  if (masked) return <span className={cn('mono select-none text-subtle', className)}>{maskValue(value) || <span className="italic">empty</span>}</span>
  if (value === '') return <span className={cn('text-xs italic text-subtle', className)}>empty</span>
  const lines = value.split('\n')
  return (
    <span className={cn('mono text-fg [overflow-wrap:anywhere]', className)}>
      {lines[0]}
      {lines.length > 1 && <span className="ml-1.5 text-2xs text-subtle">+{lines.length - 1} lines</span>}
    </span>
  )
}

const ISSUE_ICON = {
  error: <XCircle className="mt-px size-3.5 shrink-0 text-danger" />,
  warning: <AlertTriangle className="mt-px size-3.5 shrink-0 text-warn" />,
  info: <Info className="mt-px size-3.5 shrink-0 text-subtle" />,
}

function IssueList({ issues, onLocate }: { issues: EnvIssue[]; onLocate: (line: number) => void }) {
  if (!issues.length) return <EmptyState compact title="No problems found." description="Keys are valid, quotes are balanced and nothing is defined twice." />
  return (
    <ul>
      {issues.map((i, n) => (
        <li key={n}>
          <button type="button" onClick={() => onLocate(i.line)} className="flex w-full items-start gap-2 border-b border-border px-4 py-2 text-left hover:bg-surface-2/50">
            {ISSUE_ICON[i.severity]}
            <span className="min-w-0 flex-1 text-xs text-fg">{i.message}</span>
            <span className="shrink-0 text-2xs text-subtle tabular">line {i.line}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function VariablesTable({ parsed, revealAll, onLocate }: { parsed: ParsedEnv; revealAll: boolean; onLocate: (line: number) => void }) {
  const [revealed, toggle] = useRevealSet()
  const lastIndex = useMemo(() => {
    const m = new Map<string, number>()
    parsed.entries.forEach((e, i) => m.set(e.key, i))
    return m
  }, [parsed])
  if (!parsed.entries.length) return <EmptyState compact title="No variables yet." description="Lines look like KEY=value. Comments start with #." />
  return (
    <VirtualList
      items={parsed.entries}
      estimateSize={40}
      getKey={(e) => `${e.line}:${e.key}`}
      aria-label="Variables"
      header={
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(120px,38%)_1fr_44px] gap-3 border-b border-border bg-workspace px-4 py-1.5 text-2xs font-medium uppercase tracking-wider text-subtle">
          <span>Key</span>
          <span>Value</span>
          <span className="text-right">Line</span>
        </div>
      }
      renderItem={(e: EnvEntry, i) => {
        const sensitive = isSensitive(e.key, e.value)
        const id = `${e.line}`
        const masked = sensitive && !revealAll && !revealed.has(id)
        const overridden = lastIndex.get(e.key) !== i
        return (
          <div className={cn('group grid grid-cols-[minmax(120px,38%)_1fr_44px] items-start gap-3 border-b border-border px-4 py-2', overridden && 'opacity-55')}>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {sensitive && <KeyRound className="size-3 shrink-0 text-warn" aria-label="Sensitive" />}
                <span className="mono truncate text-[12.5px] font-medium text-fg" title={e.key}>
                  {e.key || <span className="italic text-danger">empty key</span>}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {e.exported && <Badge>export</Badge>}
                {e.quote !== 'none' && <Badge>{e.quote === 'double' ? '"…"' : e.quote === 'single' ? "'…'" : '`…`'}</Badge>}
                {e.references.length > 0 && <Badge tone="accent" title={`References ${e.references.join(', ')}`}>${'{'}{e.references.length > 1 ? `${e.references.length} refs` : e.references[0]}{'}'}</Badge>}
                {overridden && (
                  <Badge tone="mod" title="A later definition of this key wins">
                    overridden
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-1">
              <ValueCell value={e.value} masked={masked} className="min-w-0 flex-1 pt-px text-[12.5px] leading-5" />
              {sensitive && !revealAll && (
                <IconButton size="icon-xs" label={masked ? `Reveal ${e.key}` : `Hide ${e.key}`} icon={masked ? <Eye /> : <EyeOff />} onClick={() => toggle(id)} />
              )}
              <CopyButton value={e.value} label={`Copy value of ${e.key}`} size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
            </div>
            <button type="button" onClick={() => onLocate(e.line)} className="pt-0.5 text-right text-2xs text-subtle tabular hover:text-fg" title="Show in editor">
              {e.line === e.endLine ? e.line : `${e.line}–${e.endLine}`}
            </button>
          </div>
        )
      }}
    />
  )
}

function ExportPanel({ parsed, revealAll }: { parsed: ParsedEnv; revealAll: boolean }) {
  const [format, setFormat] = usePersistentState<ExportFormat>('exportFormat', 'json')
  const [sort, setSort] = usePersistentState('exportSort', false)
  const meta = EXPORT_FORMATS.find((f) => f.value === format)!
  const real = () => exportEnv(parsed, format, { sort })
  const preview = useMemo(
    () => exportEnv(parsed, format, { sort, transform: revealAll ? undefined : (k, v) => (isSensitive(k, v) ? maskValue(v) : v) }),
    [parsed, format, sort, revealAll],
  )
  const hasMasked = !revealAll && parsed.entries.some((e) => isSensitive(e.key, e.value) && e.value)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <Segmented aria-label="Export format" size="xs" value={format} onValueChange={setFormat} options={EXPORT_FORMATS.map((f) => ({ value: f.value, label: f.label }))} />
        <Checkbox checked={sort} onCheckedChange={(v) => setSort(v === true)} label="Sort keys" />
        <div className="ml-auto flex items-center">
          <CopyButton value={real} label="Copy export (real values)" disabled={!parsed.entries.length} />
          <DownloadButton getContent={real} filename={`env.${meta.ext}`} label="Download export (real values)" disabled={!parsed.entries.length} />
        </div>
      </div>
      {hasMasked && <p className="border-b border-border bg-warn-soft px-3 py-1.5 text-xs text-fg">Secrets are masked in this preview. Copy and Download contain the real values.</p>}
      <p className="border-b border-border px-3 py-1.5 text-2xs text-subtle">Duplicates are resolved the way dotenv does — the last definition wins.</p>
      <div className="relative min-h-0 flex-1">
        <CodeEditor value={preview} readOnly language={meta.language} ariaLabel={`${meta.label} export preview`} path="env-export" />
      </div>
    </div>
  )
}

function InspectView({ revealAll }: { revealAll: boolean }) {
  const [input, setInput] = usePersistentState('input', '')
  const [tab, setTab] = usePersistentState('tab', 'vars')
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const editor = useRef<CodeEditorHandle>(null)
  useIncomingInput(setInput)
  const text = useDebouncedValue(input, adaptiveDelay(input.length))
  const parsed = useMemo(() => parseEnv(text), [text])
  const errors = parsed.issues.filter((i) => i.severity === 'error').length
  const warnings = parsed.issues.filter((i) => i.severity === 'warning').length
  const duplicates = new Set(parsed.issues.filter((i) => i.code === 'duplicate').map((i) => i.key)).size
  const sensitiveCount = new Set(parsed.entries.filter((e) => isSensitive(e.key, e.value)).map((e) => e.key)).size

  const locate = (line: number) => {
    setMobileTab(0)
    requestAnimationFrame(() => editor.current?.revealPosition(line, 1))
  }
  const apply = (next: string, what: string) => {
    if (next === input) {
      toast.message(`Already ${what}`)
      return
    }
    if (editor.current?.editor) editor.current.replaceAll(next)
    else setInput(next)
    toast.success(`Keys ${what}`, { description: 'Undo with Ctrl/⌘+Z in the editor.' })
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-bg px-3 py-1.5 md:px-4 [scrollbar-width:none]">
        <Button size="sm" variant="ghost" disabled={!parsed.entries.length} onClick={() => apply(toDotenv(parsed, { sort: true }), 'sorted')}>
          <ArrowDownAZ /> Sort keys
        </Button>
        <Button size="sm" variant="ghost" disabled={!duplicates} onClick={() => apply(toDotenv(parsed, { dedupe: true }), 'deduplicated')}>
          <CopyMinus /> Remove duplicates{duplicates ? ` (${duplicates})` : ''}
        </Button>
        <span className="hidden text-2xs text-subtle lg:inline">Both rewrite the file in normalised form; comments attached to a key move with it.</span>
      </div>
      <SplitPane id="env-inspect" initial={0.45} mobileTabs={['.env', 'Parsed']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        <InputEditorPane
          ref={editor}
          title=".env"
          value={input}
          onChange={setInput}
          language="ini"
          sample={SAMPLE_ENV}
          accept=".env,.txt,.local,.example,.sample,.development,.production,.test,text/plain"
          markers={parsed.issues.filter((i) => i.severity !== 'info').map((i) => ({ line: i.line, column: 1, endColumn: 400, message: i.message, severity: i.severity === 'error' ? 'error' : 'warning' }))}
          placeholder="# Paste a .env file — it stays in this tab and is never saved"
          path="env-input"
        />
        <Pane aria-label="Parsed variables">
          {!text.trim() ? (
            <EmptyState
              icon={<KeyRound />}
              title="Paste a .env file to inspect it."
              description="Values of keys that look secret are masked. This tool never stores what you paste."
              actions={
                <Button size="sm" onClick={() => (editor.current?.editor ? editor.current.replaceAll(SAMPLE_ENV) : setInput(SAMPLE_ENV))}>
                  Load sample
                </Button>
              }
            />
          ) : (
            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
              <TabsList>
                <TabsTrigger value="vars">
                  Variables <span className="text-subtle tabular">{parsed.values.size}</span>
                </TabsTrigger>
                <TabsTrigger value="issues">
                  Issues
                  {errors > 0 && <span className="text-2xs text-danger tabular">{errors} err</span>}
                  {warnings > 0 && <span className="text-2xs text-warn tabular">{warnings} warn</span>}
                  {!errors && !warnings && <span className="text-2xs text-subtle tabular">{parsed.issues.length}</span>}
                </TabsTrigger>
                <TabsTrigger value="export">Export</TabsTrigger>
              </TabsList>
              <TabsContent value="vars" className="flex min-h-0 flex-1 flex-col">
                <VariablesTable parsed={parsed} revealAll={revealAll} onLocate={locate} />
              </TabsContent>
              <TabsContent value="issues" className="min-h-0 flex-1 overflow-y-auto">
                <IssueList issues={parsed.issues} onLocate={locate} />
              </TabsContent>
              <TabsContent value="export" className="flex min-h-0 flex-1 flex-col">
                <ExportPanel parsed={parsed} revealAll={revealAll} />
              </TabsContent>
            </Tabs>
          )}
        </Pane>
      </SplitPane>
      <StatusBar>
        <StatusItem label="Variables">{parsed.values.size}</StatusItem>
        <StatusItem label="Sensitive">{sensitiveCount}</StatusItem>
        {duplicates > 0 && <StatusItem label="Duplicated" tone="mod">{duplicates}</StatusItem>}
        {errors > 0 && <StatusItem label="Errors" tone="danger">{errors}</StatusItem>}
        {warnings > 0 && <StatusItem label="Warnings" tone="mod">{warnings}</StatusItem>}
        <StatusSpacer />
        <StatusItem label="Storage">never saved</StatusItem>
      </StatusBar>
    </>
  )
}

const STATUS_META: Record<CompareStatus, { label: string; tone: 'add' | 'del' | 'mod' | 'neutral' }> = {
  'only-a': { label: 'Missing in B', tone: 'del' },
  'only-b': { label: 'Missing in A', tone: 'add' },
  different: { label: 'Different', tone: 'mod' },
  same: { label: 'Identical', tone: 'neutral' },
}

function CompareView({ revealAll }: { revealAll: boolean }) {
  const [a, setA] = usePersistentState('compareA', '')
  const [b, setB] = usePersistentState('compareB', '')
  const [filter, setFilter] = usePersistentState<'all' | CompareStatus>('compareFilter', 'all')
  const [revealed, toggle] = useRevealSet()
  const isMobile = useIsMobile()
  const ra = useRef<CodeEditorHandle>(null)
  const rb = useRef<CodeEditorHandle>(null)
  const da = useDebouncedValue(a, adaptiveDelay(a.length))
  const db = useDebouncedValue(b, adaptiveDelay(b.length))
  const pa = useMemo(() => parseEnv(da), [da])
  const pb = useMemo(() => parseEnv(db), [db])
  const cmp = useMemo(() => compareEnv(pa, pb), [pa, pb])
  const rows = filter === 'all' ? cmp.rows : cmp.rows.filter((r) => r.status === filter)
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)

  const editors = (
    <SplitPane id="env-compare-editors" initial={0.5} min={120} mobileTabs={['A', 'B']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
      <InputEditorPane ref={ra} title="A · e.g. production" value={a} onChange={setA} language="ini" sample={SAMPLE_ENV} path="env-compare-a" placeholder="# First .env file" />
      <InputEditorPane ref={rb} title="B · e.g. staging" value={b} onChange={setB} language="ini" sample={SAMPLE_ENV_B} path="env-compare-b" placeholder="# Second .env file" />
    </SplitPane>
  )

  const results = (
    <Pane aria-label="Comparison">
      <PaneHeader title="Comparison" meta={`${pluralize(cmp.rows.length, 'key')} · last definition wins`}>
        <Segmented
          size="xs"
          aria-label="Show"
          value={filter}
          onValueChange={setFilter}
          className="ml-2"
          options={[
            { value: 'all', label: `All ${cmp.rows.length}` },
            { value: 'different', label: `Different ${cmp.counts.different}` },
            { value: 'only-a', label: `Missing in B ${cmp.counts['only-a']}` },
            { value: 'only-b', label: `Missing in A ${cmp.counts['only-b']}` },
            { value: 'same', label: `Identical ${cmp.counts.same}` },
          ]}
        />
      </PaneHeader>
      <PaneBody className="flex flex-col">
        {!da.trim() && !db.trim() ? (
          <EmptyState
            compact
            title="Paste two .env files to compare them."
            description="Find keys missing from one environment and values that differ — secrets stay masked."
            actions={
              <Button
                size="sm"
                onClick={() => {
                  if (ra.current?.editor) ra.current.replaceAll(SAMPLE_ENV)
                  else setA(SAMPLE_ENV)
                  if (rb.current?.editor) rb.current.replaceAll(SAMPLE_ENV_B)
                  else setB(SAMPLE_ENV_B)
                }}
              >
                Load samples
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nothing in this category.</p>
        ) : (
          <VirtualList
            items={rows}
            estimateSize={36}
            getKey={(r) => r.key}
            aria-label="Compared keys"
            header={
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(110px,26%)_110px_1fr_1fr] gap-3 border-b border-border bg-workspace px-4 py-1.5 text-2xs font-medium uppercase tracking-wider text-subtle">
                <span>Key</span>
                <span>Status</span>
                <span>A</span>
                <span>B</span>
              </div>
            }
            renderItem={(r) => {
              const sensitive = isSensitive(r.key, r.a ?? '') || isSensitive(r.key, r.b ?? '')
              const masked = sensitive && !revealAll && !revealed.has(r.key)
              const m = STATUS_META[r.status]
              return (
                <div className="grid grid-cols-[minmax(110px,26%)_110px_1fr_1fr] items-start gap-3 border-b border-border px-4 py-1.5">
                  <div className="flex min-w-0 items-center gap-1">
                    {sensitive && <KeyRound className="size-3 shrink-0 text-warn" aria-label="Sensitive" />}
                    <span className="mono truncate text-[12.5px] text-fg" title={r.key}>
                      {r.key}
                    </span>
                    {sensitive && !revealAll && r.status === 'different' && (
                      <IconButton size="icon-xs" label={masked ? `Reveal ${r.key}` : `Hide ${r.key}`} icon={masked ? <Eye /> : <EyeOff />} onClick={() => toggle(r.key)} />
                    )}
                  </div>
                  <span>
                    <Badge tone={m.tone}>{m.label}</Badge>
                  </span>
                  <span className="min-w-0 text-[12.5px]">{r.a === undefined ? <span className="text-xs text-subtle">—</span> : <ValueCell value={r.a} masked={masked} />}</span>
                  <span className="min-w-0 text-[12.5px]">{r.b === undefined ? <span className="text-xs text-subtle">—</span> : <ValueCell value={r.b} masked={masked} />}</span>
                </div>
              )
            }}
          />
        )}
      </PaneBody>
    </Pane>
  )

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <SplitPane direction="vertical" id="env-compare" initial={isMobile ? 0.5 : 0.55} min={140}>
          <div className="flex min-h-0 flex-1 flex-col">{editors}</div>
          {results}
        </SplitPane>
      </div>
      <StatusBar>
        <StatusItem label="A">{pluralize(pa.values.size, 'key')}</StatusItem>
        <StatusItem label="B">{pluralize(pb.values.size, 'key')}</StatusItem>
        <StatusItem label="Missing in B" tone={cmp.counts['only-a'] ? 'del' : undefined}>
          {cmp.counts['only-a']}
        </StatusItem>
        <StatusItem label="Missing in A" tone={cmp.counts['only-b'] ? 'add' : undefined}>
          {cmp.counts['only-b']}
        </StatusItem>
        <StatusItem label="Different" tone={cmp.counts.different ? 'mod' : undefined}>
          {cmp.counts.different}
        </StatusItem>
        <StatusSpacer />
        <StatusItem label="Masked as">{MASK}</StatusItem>
      </StatusBar>
    </>
  )
}

export default function EnvTool() {
  const [mode, setMode] = usePersistentState<'inspect' | 'compare'>('mode', 'inspect')
  const [revealAll, setRevealAll] = useState(false)
  return (
    <>
      <Toolbar>
        <Segmented
          aria-label="Mode"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'inspect', label: 'Inspect', tooltip: 'Parse, validate, normalise and export one file' },
            { value: 'compare', label: 'Compare', tooltip: 'Compare two .env files key by key' },
          ]}
        />
        <ToolbarSeparator />
        <span className="shrink-0 whitespace-nowrap">
          <Switch checked={revealAll} onCheckedChange={setRevealAll} label="Reveal all secrets" />
        </span>
        <ToolbarSpacer />
        <span className="hidden text-xs text-subtle md:inline">Sensitive tool — input is never saved or sent anywhere</span>
      </Toolbar>
      {mode === 'inspect' ? <InspectView revealAll={revealAll} /> : <CompareView revealAll={revealAll} />}
    </>
  )
}
