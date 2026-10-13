import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowDownAZ, ArrowUp, Copy, Eraser, Eye, EyeOff, Link, MoreHorizontal, Plus, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  applyUrlPart,
  encodeQueryComponent,
  parseUrl,
  percentEncode,
  safeDecode,
  serializeQuery,
  withQuery,
  type ParsedUrl,
  type QueryParam,
  type UrlPart,
} from '@/engines/url/parse'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { Input, Textarea } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Segmented } from '@/components/ui/segmented'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CopyButton } from '@/components/common/CopyButton'
import { copyText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'

const SAMPLE = 'https://user:s3cret@api.example.com:8443/v2/search/caf%C3%A9%20menus?q=open+now&tag=vegan&tag=gluten-free&sort=-rating&page=2&utm_source=newsletter#results'

interface Row extends QueryParam {
  id: string
}

const newId = () => crypto.randomUUID().slice(0, 8)

export default function UrlTool() {
  const [input, setInput] = usePersistentState('input', '')
  const [base, setBase] = usePersistentState('base', '')
  const [useBase, setUseBase] = usePersistentState('useBase', false)
  const [spaceAsPlus, setSpaceAsPlus] = usePersistentState('spaceAsPlus', true)
  const [rows, setRows] = useState<Row[]>([])
  /** href produced by the last table edit — re-parsing it must not rebuild the rows (keeps focus and ids). */
  const tableHref = useRef<string | null>(null)
  useIncomingInput(setInput)

  const parsed = useMemo(() => (input.trim() ? parseUrl(input, useBase ? base : undefined) : null), [input, base, useBase])
  const url = parsed?.ok ? parsed.url : null

  // Text edits re-derive the table; table edits rewrite the text (and must not re-derive, to keep focus).
  useEffect(() => {
    if (url && url.href === tableHref.current) return
    tableHref.current = null
    setRows(url ? url.params.map((p) => ({ ...p, id: newId() })) : [])
  }, [url?.href]) // eslint-disable-line react-hooks/exhaustive-deps

  const writeQuery = (next: Row[], plus: boolean) => {
    if (!url) return
    const href = withQuery(url.href, next, plus)
    tableHref.current = href
    setInput(href)
  }
  const updateRows = (next: Row[]) => {
    setRows(next)
    writeQuery(next, spaceAsPlus)
  }
  const patchRow = (id: string, p: Partial<Row>) => updateRows(rows.map((r) => (r.id === id ? { ...r, ...p, bare: p.value !== undefined && p.value !== '' ? false : r.bare } : r)))
  const moveRow = (id: string, dir: -1 | 1) => {
    const i = rows.findIndex((r) => r.id === id)
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    updateRows(next)
  }

  const applyPart = (part: UrlPart, value: string): string | null => {
    if (!url) return 'Invalid URL'
    const r = applyUrlPart(url.href, part, value)
    if (!r.ok) return r.error
    setInput(r.href)
    return null
  }

  const keyCounts = useMemo(() => rows.reduce<Record<string, number>>((acc, r) => ((acc[r.key] = (acc[r.key] ?? 0) + 1), acc), {}), [rows])
  const query = serializeQuery(rows, spaceAsPlus)

  return (
    <>
      <Toolbar>
        <Checkbox checked={useBase} onCheckedChange={(v) => setUseBase(v === true)} label="Resolve against base URL" />
        {useBase && (
          <Input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://example.com/docs/" aria-label="Base URL" className="mono h-7 w-[260px] text-[12.5px]" />
        )}
        <ToolbarSeparator />
        <ToolbarField label="Spaces in query">
          <Segmented
            aria-label="Encode spaces in the query as"
            value={spaceAsPlus ? 'plus' : 'pct'}
            onValueChange={(v) => {
              setSpaceAsPlus(v === 'plus')
              if (rows.length) writeQuery(rows, v === 'plus')
            }}
            options={[
              { value: 'plus', label: '+', tooltip: 'application/x-www-form-urlencoded (what forms and URLSearchParams use)' },
              { value: 'pct', label: '%20', tooltip: 'RFC 3986 percent-encoding' },
            ]}
          />
        </ToolbarField>
        <ToolbarSpacer />
        <Button size="sm" variant="ghost" onClick={() => setInput(SAMPLE)}>
          <Sparkles /> Sample
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setInput('')} disabled={!input}>
          <Eraser /> Clear
        </Button>
      </Toolbar>
      <div className="shrink-0 border-b border-border bg-workspace px-3 py-3 md:px-4">
        <div className="flex items-start gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="URL"
            aria-invalid={!!parsed && !parsed.ok}
            placeholder="https://example.com/path?query=value#fragment"
            rows={Math.min(5, Math.max(1, Math.ceil(input.length / 110)))}
            className="mono min-h-9 flex-1 resize-none py-2 text-[13px] leading-5 [word-break:break-all]"
          />
          <CopyButton value={url?.href ?? input} label="Copy URL" disabled={!input} variant="secondary" size="icon" />
        </div>
        {url && url.href !== input.trim() && (
          <p className="mt-1.5 truncate text-2xs text-subtle">
            Normalized: <span className="mono text-muted">{url.href}</span>
          </p>
        )}
      </div>
      {parsed && !parsed.ok && <ErrorDisplay error={parsed.error} />}
      {!input.trim() ? (
        <div className="flex-1 bg-workspace">
          <EmptyState
            icon={<Link />}
            title="Paste a URL to inspect and edit it"
            description="See every component, decoded path segments and an editable query-parameter table. Edits rebuild the URL instantly; everything stays in your browser."
            actions={
              <Button size="sm" onClick={() => setInput(SAMPLE)}>
                Load sample URL
              </Button>
            }
          />
        </div>
      ) : (
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto bg-workspace lg:flex-row lg:overflow-hidden', !url && 'pointer-events-none opacity-50')}>
          <section aria-label="Components" className="shrink-0 border-b border-border lg:min-h-0 lg:w-[44%] lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <h2 className="eyebrow px-4 pb-1 pt-3">Components</h2>
            {url && <Components url={url} onApply={applyPart} />}
          </section>
          <section aria-label="Query parameters" className="flex min-h-[260px] min-w-0 flex-1 flex-col lg:min-h-0">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
              <h2 className="eyebrow">Query parameters</h2>
              <span className="tabular text-2xs text-subtle">{rows.length}</span>
              <div className="ml-auto flex items-center gap-0.5">
                <Button size="xs" variant="ghost" disabled={rows.length < 2} onClick={() => updateRows([...rows].sort((a, b) => a.key.localeCompare(b.key)))}>
                  <ArrowDownAZ /> Sort
                </Button>
                <Button size="xs" variant="ghost" disabled={!rows.length} onClick={() => updateRows([])}>
                  <Trash2 /> Remove all
                </Button>
                <Button size="xs" variant="secondary" onClick={() => updateRows([...rows, { id: newId(), key: '', value: '' }])}>
                  <Plus /> Add
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {rows.length === 0 ? (
                <EmptyState compact title="No query parameters" description="Add one to build a query string — keys and values are encoded for you." />
              ) : (
                <ul className="flex flex-col py-1" aria-label="Parameters">
                  <li aria-hidden className="grid grid-cols-[20px_minmax(0,0.8fr)_minmax(0,1.2fr)_56px] gap-2 px-4 pb-1 pt-1 text-2xs text-subtle">
                    <span />
                    <span>Key</span>
                    <span>Value (decoded)</span>
                    <span />
                  </li>
                  {rows.map((r, i) => (
                    <li key={r.id} className="group grid grid-cols-[20px_minmax(0,0.8fr)_minmax(0,1.2fr)_56px] items-center gap-2 px-4 py-1">
                      <span className="tabular text-right text-2xs text-subtle">{i + 1}</span>
                      <div className="relative min-w-0">
                        <Input value={r.key} onChange={(e) => patchRow(r.id, { key: e.target.value })} aria-label={`Parameter ${i + 1} key`} placeholder="key" className="mono h-7 pr-9 text-[12.5px]" />
                        {keyCounts[r.key] > 1 && r.key && (
                          <Badge tone="mod" className="absolute right-1.5 top-1/2 -translate-y-1/2" title="This key appears more than once (allowed — e.g. arrays)">
                            ×{keyCounts[r.key]}
                          </Badge>
                        )}
                      </div>
                      <Input value={r.value} onChange={(e) => patchRow(r.id, { value: e.target.value })} aria-label={`Parameter ${i + 1} value`} placeholder={r.bare ? '(no value)' : 'value'} className="mono h-7 text-[12.5px]" />
                      <div className="flex items-center justify-end">
                        <RowMenu
                          first={i === 0}
                          last={i === rows.length - 1}
                          row={r}
                          spaceAsPlus={spaceAsPlus}
                          onMove={(d) => moveRow(r.id, d)}
                          onDuplicate={() => updateRows([...rows.slice(0, i + 1), { ...r, id: newId() }, ...rows.slice(i + 1)])}
                          onPatch={(p) => patchRow(r.id, p)}
                        />
                        <IconButton label={`Remove parameter ${i + 1}`} size="icon-xs" icon={<Trash2 />} onClick={() => updateRows(rows.filter((x) => x.id !== r.id))} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {rows.length > 0 && (
              <div className="flex shrink-0 items-start gap-2 border-t border-border px-4 py-2">
                <span className="mt-0.5 shrink-0 text-2xs text-subtle">Query</span>
                <code className="mono min-w-0 flex-1 break-all text-[12px] leading-[18px] text-muted">?{query}</code>
                <CopyButton value={`?${query}`} label="Copy query string" size="icon-xs" />
              </div>
            )}
          </section>
        </div>
      )}
      <StatusBar>
        <StatusItem label="Scheme">{url ? url.protocol.replace(':', '') : '—'}</StatusItem>
        <StatusItem label="Host">{url ? url.hostnameUnicode || '(none)' : '—'}</StatusItem>
        <StatusItem label="Segments">{url ? url.segments.length : '—'}</StatusItem>
        <StatusItem label="Params">{rows.length}</StatusItem>
        <StatusItem label="Length">{url ? url.href.length : input.length}</StatusItem>
        <StatusSpacer />
        {parsed && !parsed.ok ? <StatusItem tone="danger">Invalid URL</StatusItem> : url && <StatusItem tone="ok">Valid</StatusItem>}
      </StatusBar>
    </>
  )
}

function RowMenu({
  first,
  last,
  row,
  spaceAsPlus,
  onMove,
  onDuplicate,
  onPatch,
}: {
  first: boolean
  last: boolean
  row: Row
  spaceAsPlus: boolean
  onMove: (d: -1 | 1) => void
  onDuplicate: () => void
  onPatch: (p: Partial<Row>) => void
}) {
  const decoded = safeDecode(row.value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Parameter actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}>
          <ArrowUp /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
          <ArrowDown /> Move down
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}>
          <Copy /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={decoded === row.value} onSelect={() => onPatch({ value: decoded })}>
          Decode %-escapes in value
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!row.value} onSelect={() => onPatch({ value: percentEncode(row.value) })}>
          Percent-encode the value text
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void copyText(row.value).then((ok) => ok && toast.success('Value copied'))}>Copy value (decoded)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyText(encodeQueryComponent(row.value, spaceAsPlus)).then((ok) => ok && toast.success('Encoded value copied'))}>Copy value (encoded)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyText(`${encodeQueryComponent(row.key, spaceAsPlus)}=${encodeQueryComponent(row.value, spaceAsPlus)}`).then((ok) => ok && toast.success('Pair copied'))}>
          Copy key=value (encoded)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Components({ url, onApply }: { url: ParsedUrl; onApply: (part: UrlPart, value: string) => string | null }) {
  const [showPassword, setShowPassword] = useState(false)
  const portHint = url.defaultPort !== null ? (url.port ? `default for ${url.protocol} is ${url.defaultPort}` : url.droppedDefaultPort ? `${url.defaultPort} is the default for ${url.protocol} — omitted` : `default ${url.defaultPort}`) : undefined
  return (
    <div className="flex flex-col px-4 pb-4">
      <PartRow label="Protocol" value={url.protocol} part="protocol" onApply={onApply} hint={url.isSpecial ? undefined : 'Non-special scheme'} />
      <PartRow label="Username" value={url.username} part="username" onApply={onApply} placeholder="(none)" />
      <PartRow
        label="Password"
        value={url.password}
        part="password"
        onApply={onApply}
        placeholder="(none)"
        masked={!showPassword}
        extra={url.password ? <IconButton label={showPassword ? 'Hide password' : 'Reveal password'} size="icon-xs" icon={showPassword ? <EyeOff /> : <Eye />} onClick={() => setShowPassword(!showPassword)} /> : undefined}
        hint={url.password ? 'Credentials in URLs are visible in logs and history' : undefined}
        hintTone="warn"
      />
      <PartRow
        label="Hostname"
        value={url.hostname}
        part="hostname"
        onApply={onApply}
        hint={url.hostnameUnicode !== url.hostname ? `Unicode: ${url.hostnameUnicode}` : undefined}
        copyExtra={url.hostnameUnicode !== url.hostname ? url.hostnameUnicode : undefined}
      />
      <PartRow label="Port" value={url.port} part="port" onApply={onApply} placeholder={url.defaultPort !== null ? String(url.defaultPort) : '(none)'} hint={portHint} />
      <PartRow label="Path" value={url.pathname} part="pathname" onApply={onApply} />
      {url.segments.length > 0 && (
        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 pb-2">
          <span />
          <ol className="flex flex-wrap items-center gap-1" aria-label="Decoded path segments">
            {url.segments.map((s, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-2xs text-subtle">/</span>}
                <span className={cn('mono rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-fg', !s && 'italic text-subtle')} title={`Segment ${i + 1}`}>
                  {s || 'empty'}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <PartRow label="Fragment" value={url.hash.replace(/^#/, '')} part="hash" onApply={onApply} placeholder="(none)" hint={url.hash && url.hashDecoded !== url.hash.slice(1) ? `Decoded: ${url.hashDecoded}` : undefined} />
      <div className="mt-2 border-t border-border pt-2">
        <ReadRow label="Origin" value={url.origin === 'null' ? 'null (opaque origin)' : url.origin} copy={url.origin} />
        <ReadRow label="Host" value={url.host || '(none)'} copy={url.host} />
        <ReadRow label="Search" value={url.search || '(none)'} copy={url.search} />
      </div>
    </div>
  )
}

function PartRow({
  label,
  value,
  part,
  onApply,
  placeholder,
  hint,
  hintTone,
  masked,
  extra,
  copyExtra,
}: {
  label: string
  value: string
  part: UrlPart
  onApply: (part: UrlPart, value: string) => string | null
  placeholder?: string
  hint?: string
  hintTone?: 'warn'
  masked?: boolean
  extra?: React.ReactNode
  copyExtra?: string
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) {
      setDraft(value)
      setError(null)
    }
  }, [value])
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-2 py-1">
      <label className="pt-1.5 text-xs text-muted" htmlFor={`url-part-${part}`}>
        {label}
      </label>
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <Input
            id={`url-part-${part}`}
            type={masked ? 'password' : 'text'}
            value={draft}
            placeholder={placeholder}
            aria-invalid={!!error}
            autoComplete="off"
            onFocus={() => (focused.current = true)}
            onBlur={() => {
              focused.current = false
              if (!error) setDraft(value)
            }}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(onApply(part, e.target.value))
            }}
            className="mono h-7 text-[12.5px]"
          />
          {extra}
          <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} size="icon-xs" disabled={!value} />
        </div>
        {error ? (
          <p className="mt-1 text-2xs text-danger">{error}</p>
        ) : (
          hint && (
            <p className={cn('mt-1 flex items-center gap-1 text-2xs', hintTone === 'warn' ? 'text-warn' : 'text-subtle')}>
              <span className="truncate">{hint}</span>
              {copyExtra && <CopyButton value={copyExtra} label="Copy Unicode hostname" size="icon-xs" className="-my-1 size-5" />}
            </p>
          )
        )}
      </div>
    </div>
  )
}

function ReadRow({ label, value, copy }: { label: string; value: string; copy: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2 py-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="mono truncate text-[12.5px] text-fg">{value}</span>
      <CopyButton value={copy} label={`Copy ${label.toLowerCase()}`} size="icon-xs" disabled={!copy} />
    </div>
  )
}
