import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CornerDownRight, Info, ShieldCheck, XCircle } from 'lucide-react'
import type { CodeEditorHandle } from '@/components/editors/CodeEditor'
import { InputEditorPane } from '@/components/tools/EditorPane'
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { SplitPane } from '@/components/tools/SplitPane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { Pane } from '@/components/tools/Pane'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
import { CopyButton } from '@/components/common/CopyButton'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { adaptiveDelay, useDebouncedValue } from '@/hooks/useDebounced'
import {
  auditResponse,
  auditSummary,
  headerInfo,
  maskSecret,
  parseHeaders,
  SAMPLE_REQUEST,
  SAMPLE_RESPONSE,
  structuredValue,
  type AuditCheck,
  type HeaderEntry,
} from '@/engines/dev/http-headers'
import { VirtualList } from '../_shared/VirtualList'
import { maskCookieHeader, StructuredView } from './structured'
import { cn } from '@/utils/cn'
import { pluralize } from '@/utils/format'

const SECRET_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token', 'x-csrf-token', 'x-amz-security-token'])

function displayValue(h: HeaderEntry, reveal: boolean) {
  if (reveal || !SECRET_HEADERS.has(h.lower)) return h.value
  if (h.lower === 'cookie') return maskCookieHeader(h.value)
  if (h.lower === 'set-cookie') {
    const semi = h.value.indexOf(';')
    const first = semi === -1 ? h.value : h.value.slice(0, semi)
    const eq = first.indexOf('=')
    return `${eq === -1 ? '' : first.slice(0, eq + 1)}${maskSecret(eq === -1 ? first : first.slice(eq + 1))}${semi === -1 ? '' : h.value.slice(semi)}`
  }
  if (h.lower === 'authorization' || h.lower === 'proxy-authorization') {
    const sp = h.value.indexOf(' ')
    return sp === -1 ? maskSecret(h.value) : `${h.value.slice(0, sp)} ${maskSecret(h.value.slice(sp + 1))}`
  }
  return maskSecret(h.value)
}

const STATUS_ICON = {
  pass: <CheckCircle2 className="size-4 text-ok" aria-label="Pass" />,
  warn: <AlertTriangle className="size-4 text-warn" aria-label="Warning" />,
  fail: <XCircle className="size-4 text-danger" aria-label="Fail" />,
  info: <Info className="size-4 text-subtle" aria-label="Info" />,
}

function HeaderRow({ h, reveal, count, onLocate }: { h: HeaderEntry; reveal: boolean; count: number; onLocate: (line: number) => void }) {
  const info = headerInfo(h.lower)
  const s = useMemo(() => structuredValue(h.lower, h.value), [h.lower, h.value])
  const value = displayValue(h, reveal)
  return (
    <div className="group grid grid-cols-1 gap-1 border-b border-border px-4 py-2.5 md:grid-cols-[minmax(160px,220px)_1fr] md:gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => onLocate(h.line)} className="mono truncate text-left text-[12.5px] font-medium text-accent-text hover:underline" title={`Line ${h.line} — show in editor`}>
            {h.name}
          </button>
          {count > 1 && (
            <Badge tone="mod" title={`${h.name} appears ${count} times`}>
              ×{count}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-subtle">{info ? info.category : h.lower.startsWith('x-') ? 'Custom' : 'Unknown'}</span>
          {h.folded && <span className="text-2xs text-warn">folded</span>}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <p className="mono min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-[12.5px] leading-5 text-fg">{value || <span className="text-subtle">(empty)</span>}</p>
          <CopyButton value={h.value} label={`Copy ${h.name} value`} size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
        </div>
        {info && <p className="mt-0.5 text-xs text-muted">{info.description}</p>}
        {s && (
          <div className="mt-2 rounded-md border border-border bg-surface/50 px-2.5 py-2">
            <StructuredView s={s} reveal={reveal} />
          </div>
        )}
      </div>
    </div>
  )
}

function AuditRow({ c, onLocate }: { c: AuditCheck; onLocate?: () => void }) {
  return (
    <li className="flex items-start gap-3 border-b border-border px-4 py-2.5">
      <span className="mt-0.5 shrink-0">{STATUS_ICON[c.status]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{c.title}</p>
        <p className="text-xs text-muted">{c.detail}</p>
      </div>
      {onLocate && <IconButton label={`Show ${c.header} in the editor`} icon={<CornerDownRight />} size="icon-xs" onClick={onLocate} />}
    </li>
  )
}

export default function HttpHeaderParser() {
  const [input, setInput] = usePersistentState('input', '')
  const [tab, setTab] = usePersistentState('tab', 'headers')
  const [reveal, setReveal] = useState(false)
  const [filter, setFilter] = useState('')
  const [mobileTab, setMobileTab] = useState<0 | 1>(0)
  const editor = useRef<CodeEditorHandle>(null)
  useIncomingInput(setInput)

  const text = useDebouncedValue(input, adaptiveDelay(input.length))
  const parsed = useMemo(() => parseHeaders(text), [text])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of parsed.headers) m.set(h.lower, (m.get(h.lower) ?? 0) + 1)
    return m
  }, [parsed])
  const isRequest = parsed.kind === 'request'
  const audit = useMemo(() => (isRequest || !parsed.headers.length ? [] : auditResponse(parsed.headers)), [parsed, isRequest])
  const summary = auditSummary(audit)
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return parsed.headers
    return parsed.headers.filter((h) => h.lower.includes(q) || h.value.toLowerCase().includes(q) || (headerInfo(h.lower)?.category.toLowerCase().includes(q) ?? false))
  }, [parsed, filter])

  const locate = (line: number) => {
    setMobileTab(0)
    requestAnimationFrame(() => editor.current?.revealPosition(line, 1))
  }
  const load = (sample: string) => {
    if (editor.current?.editor) editor.current.replaceAll(sample)
    else setInput(sample)
  }
  const hasSecrets = parsed.headers.some((h) => SECRET_HEADERS.has(h.lower))
  const effectiveTab = isRequest && tab === 'audit' ? 'headers' : tab
  const start = parsed.startLine

  const summaryBar = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2.5">
      <Badge tone={parsed.kind === 'response' ? 'accent' : parsed.kind === 'request' ? 'mod' : 'neutral'}>{parsed.kind === 'unknown' ? 'Headers' : parsed.kind === 'request' ? 'Request' : 'Response'}</Badge>
      {start?.kind === 'request' && (
        <span className="mono min-w-0 truncate text-[12.5px] text-fg">
          <span className="font-medium">{start.method}</span> {start.target} <span className="text-subtle">{start.version}</span>
        </span>
      )}
      {start?.kind === 'response' && (
        <span className="mono text-[12.5px] text-fg">
          <span className="text-subtle">{start.version}</span>{' '}
          <span className={cn('font-medium', start.status >= 500 ? 'text-danger' : start.status >= 400 ? 'text-warn' : start.status >= 300 ? 'text-mod' : 'text-ok')}>{start.status}</span> {start.reason}
        </span>
      )}
      <span className="text-xs text-subtle">{pluralize(parsed.headers.length, 'header')}</span>
      <div className="ml-auto flex items-center gap-1">
        <CopyButton
          value={() => JSON.stringify({ startLine: parsed.startLine, headers: parsed.headers.map((h) => ({ name: h.name, value: h.value, line: h.line })) }, null, 2)}
          label="Copy parsed headers as JSON (real values)"
          disabled={!parsed.headers.length}
        />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter headers…" aria-label="Filter headers" className="h-7 w-44" />
      </div>
    </div>
  )

  const issues = parsed.issues.length ? (
    <ul className="border-b border-border">
      {parsed.issues.map((i, n) => (
        <li key={n} className={cn('flex items-start gap-2 px-4 py-1.5 text-xs', i.severity === 'error' ? 'bg-danger-soft' : 'bg-warn-soft')}>
          {i.severity === 'error' ? <XCircle className="mt-px size-3.5 shrink-0 text-danger" /> : <AlertTriangle className="mt-px size-3.5 shrink-0 text-warn" />}
          <span className="min-w-0 flex-1 text-fg">{i.message}</span>
          <button type="button" className="shrink-0 text-muted tabular hover:text-fg" onClick={() => locate(i.line)}>
            line {i.line}
          </button>
        </li>
      ))}
    </ul>
  ) : null

  const right = (
    <Pane aria-label="Parsed headers">
      {!text.trim() ? (
        <EmptyState
          icon={<ShieldCheck />}
          title="Paste raw HTTP headers"
          description="From devtools, curl -i or a proxy log. Request or response, with or without the first line. Folded and duplicate headers are handled."
          actions={
            <>
              <Button size="sm" onClick={() => load(SAMPLE_RESPONSE)}>
                Sample response
              </Button>
              <Button size="sm" variant="ghost" onClick={() => load(SAMPLE_REQUEST)}>
                Sample request
              </Button>
            </>
          }
        />
      ) : (
        <Tabs value={effectiveTab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="headers">
              Headers <span className="text-subtle tabular">{parsed.headers.length}</span>
            </TabsTrigger>
            {!isRequest && (
              <TabsTrigger value="audit">
                Security audit
                {audit.length > 0 && (
                  <span className="flex items-center gap-1.5 text-2xs tabular">
                    {summary.fail > 0 && <span className="text-danger">{summary.fail} fail</span>}
                    {summary.warn > 0 && <span className="text-warn">{summary.warn} warn</span>}
                    {summary.fail + summary.warn === 0 && <span className="text-ok">all pass</span>}
                  </span>
                )}
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="headers" className="flex min-h-0 flex-1 flex-col">
            <VirtualList
              items={shown}
              estimateSize={72}
              getKey={(h) => `${h.line}:${h.lower}`}
              header={
                <>
                  {summaryBar}
                  {issues}
                </>
              }
              footer={filter && shown.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No header matches “{filter}”.</p> : null}
              renderItem={(h) => <HeaderRow h={h} reveal={reveal} count={counts.get(h.lower) ?? 1} onLocate={locate} />}
              aria-label="Headers"
            />
          </TabsContent>
          {!isRequest && (
            <TabsContent value="audit" className="min-h-0 flex-1 overflow-y-auto">
              {parsed.kind === 'unknown' && (
                <p className="border-b border-border bg-surface px-4 py-2 text-xs text-muted">No status line found — auditing as a response. Add the status line or response headers to confirm.</p>
              )}
              <div className="grid grid-cols-4 gap-px border-b border-border bg-border">
                {(['fail', 'warn', 'pass', 'info'] as const).map((k) => (
                  <div key={k} className="bg-workspace px-4 py-2">
                    <p className="text-2xs capitalize text-subtle">{k === 'info' ? 'Info' : k === 'warn' ? 'Warnings' : k === 'fail' ? 'Failures' : 'Passed'}</p>
                    <p className={cn('mono text-lg tabular', k === 'fail' ? 'text-danger' : k === 'warn' ? 'text-warn' : k === 'pass' ? 'text-ok' : 'text-muted')}>{summary[k]}</p>
                  </div>
                ))}
              </div>
              <ul>
                {[...audit]
                  .sort((a, b) => ['fail', 'warn', 'info', 'pass'].indexOf(a.status) - ['fail', 'warn', 'info', 'pass'].indexOf(b.status))
                  .map((c) => {
                    const h = c.header ? parsed.headers.find((x) => x.lower === c.header) : undefined
                    return <AuditRow key={c.id} c={c} onLocate={h ? () => locate(h.line) : undefined} />
                  })}
              </ul>
              <p className="px-4 py-3 text-2xs text-subtle">Checks follow OWASP Secure Headers guidance. They look at headers only — a pass does not mean the site is secure.</p>
            </TabsContent>
          )}
        </Tabs>
      )}
    </Pane>
  )

  return (
    <>
      <Toolbar>
        <Button size="sm" variant="ghost" onClick={() => load(SAMPLE_RESPONSE)}>
          Sample response
        </Button>
        <Button size="sm" variant="ghost" onClick={() => load(SAMPLE_REQUEST)}>
          Sample request
        </Button>
        <ToolbarSeparator />
        <span className="shrink-0 whitespace-nowrap">
          <Switch checked={reveal} onCheckedChange={setReveal} label="Reveal credentials" disabled={!hasSecrets} />
        </span>
        <ToolbarSpacer />
        <span className="hidden text-xs text-subtle lg:inline">Secrets in Authorization and cookies are masked by default</span>
      </Toolbar>
      <SplitPane id="http-headers" initial={0.42} mobileTabs={['Raw', 'Parsed']} mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
        <InputEditorPane
          ref={editor}
          title="Raw headers"
          value={input}
          onChange={setInput}
          sample={SAMPLE_RESPONSE}
          sampleLabel="Load sample response"
          placeholder={'HTTP/1.1 200 OK\nContent-Type: application/json\n…'}
          markers={parsed.issues.filter((i) => i.severity === 'error').map((i) => ({ line: i.line, column: 1, endColumn: 200, message: i.message }))}
          wordWrap
          path="http-headers-input"
        />
        {right}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Type">{parsed.kind}</StatusItem>
        <StatusItem label="Headers">{parsed.headers.length}</StatusItem>
        {parsed.duplicates.length > 0 && <StatusItem label="Repeated" tone="mod">{parsed.duplicates.length}</StatusItem>}
        {parsed.issues.length > 0 && (
          <StatusItem label="Issues" tone={parsed.issues.some((i) => i.severity === 'error') ? 'danger' : 'mod'}>
            {parsed.issues.length}
          </StatusItem>
        )}
        <StatusSpacer />
        {audit.length > 0 && (
          <StatusItem label="Audit">
            <span className="text-danger">{summary.fail} fail</span> · <span className="text-warn">{summary.warn} warn</span> · <span className="text-ok">{summary.pass} pass</span>
          </StatusItem>
        )}
      </StatusBar>
    </>
  )
}
