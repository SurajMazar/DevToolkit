import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { NativeSelect } from '@/components/ui/select'
import { CopyButton } from '@/components/common/CopyButton'
import type { AnalysisOk, ArrayStats, JsonType, ShapeNode, ValueStats } from '@/engines/dev/api-inspect'
import { VirtualList } from '../_shared/VirtualList'
import { cn } from '@/utils/cn'
import { formatBytes, formatNumber } from '@/utils/format'

export const TYPE_ORDER: JsonType[] = ['object', 'array', 'string', 'number', 'boolean', 'null']

export const TYPE_STYLE: Record<JsonType, { bar: string; badge: 'accent' | 'mod' | 'add' | 'del' | 'neutral' | 'warn' }> = {
  object: { bar: 'bg-accent', badge: 'accent' },
  array: { bar: 'bg-mod', badge: 'mod' },
  string: { bar: 'bg-add', badge: 'add' },
  number: { bar: 'bg-del', badge: 'del' },
  boolean: { bar: 'bg-muted', badge: 'neutral' },
  null: { bar: 'bg-border-strong', badge: 'neutral' },
}

export const TYPE_TEXT: Record<JsonType, string> = {
  object: 'text-accent-text',
  array: 'text-mod',
  string: 'text-add',
  number: 'text-del',
  boolean: 'text-muted',
  null: 'text-subtle',
}

export function TypeBadges({ types, total }: { types: Partial<Record<JsonType, number>>; total?: number }) {
  const entries = TYPE_ORDER.filter((t) => types[t])
  return (
    <span className="inline-flex flex-wrap gap-1">
      {entries.map((t) => (
        <Badge key={t} tone={TYPE_STYLE[t].badge} title={`${formatNumber(types[t]!)} ${t}${total ? ` of ${formatNumber(total)}` : ''}`}>
          {t}
          {entries.length > 1 && <span className="opacity-70">{formatNumber(types[t]!)}</span>}
        </Badge>
      ))}
    </span>
  )
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="bg-workspace px-4 py-2.5">
      <dt className="text-2xs text-subtle">{label}</dt>
      <dd className="mono mt-0.5 text-sm tabular text-fg">{value}</dd>
      {hint && <dd className="text-2xs text-subtle">{hint}</dd>}
    </div>
  )
}

export function OverviewPanel({ a, textBytes }: { a: AnalysisOk; textBytes: number }) {
  const o = a.overview
  const total = TYPE_ORDER.reduce((n, t) => n + o.counts[t], 0)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {a.envelope && (
        <div className="border-b border-border px-4 py-2.5">
          <p className="eyebrow mb-1">HTTP envelope stripped</p>
          {a.envelope.statusLines.map((s, i) => (
            <p key={i} className="mono text-[12.5px] text-fg">
              {s}
            </p>
          ))}
          {a.envelope.headers.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-default text-xs text-muted hover:text-fg">{a.envelope.headers.length} headers</summary>
              <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
                {a.envelope.headers.map((h, i) => (
                  <div key={i} className="contents">
                    <dt className="mono text-[12px] text-muted">{h.name}</dt>
                    <dd className="mono break-all text-[12px] text-fg">{h.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3">
        <Stat label="Body size" value={formatBytes(a.bodyBytes)} hint={a.envelope ? `${formatBytes(textBytes)} with headers` : undefined} />
        <Stat label="Root" value={a.rootType} />
        <Stat label="Max depth" value={formatNumber(o.depth)} />
        <Stat label="Nodes" value={formatNumber(o.nodes)} />
        <Stat label="Keys" value={formatNumber(o.totalKeys)} hint={`${formatNumber(o.uniqueKeys)} distinct names`} />
        <Stat label="Arrays" value={formatNumber(o.arrays)} hint={o.arrays ? `longest ${formatNumber(o.maxArrayLength)} items` : undefined} />
        <Stat label="Longest string" value={`${formatNumber(o.longestString)} chars`} />
        <Stat label="Empty {} / []" value={formatNumber(o.emptyContainers)} />
        <Stat label="Big numbers" value={a.hasBigNumbers ? 'yes' : 'no'} hint={a.hasBigNumbers ? 'kept exact (beyond 2^53)' : undefined} />
      </dl>
      <div className="px-4 py-3">
        <p className="eyebrow mb-2">Nodes by type</p>
        <div className="flex h-2 w-full overflow-hidden rounded-sm bg-surface" role="img" aria-label="Node type distribution">
          {TYPE_ORDER.filter((t) => o.counts[t]).map((t) => (
            <div key={t} className={TYPE_STYLE[t].bar} style={{ width: `${(o.counts[t] / total) * 100}%` }} title={`${t}: ${o.counts[t]}`} />
          ))}
        </div>
        <ul className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          {TYPE_ORDER.map((t) => (
            <li key={t} className="flex items-center gap-2 text-xs">
              <span className={cn('size-2 rounded-[2px]', TYPE_STYLE[t].bar)} />
              <span className="text-muted">{t}</span>
              <span className="mono ml-auto tabular text-fg">{formatNumber(o.counts[t])}</span>
              <span className="w-10 text-right text-2xs text-subtle tabular">{total ? `${Math.round((o.counts[t] / total) * 100)}%` : ''}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shape tree
// ---------------------------------------------------------------------------

interface FlatShape {
  node: ShapeNode
  depth: number
  hasChildren: boolean
}

function flattenShape(root: ShapeNode, expanded: Set<string>): FlatShape[] {
  const out: FlatShape[] = []
  const walk = (n: ShapeNode, depth: number) => {
    out.push({ node: n, depth, hasChildren: !!n.children?.length })
    if (n.children && expanded.has(n.path)) for (const c of n.children) walk(c, depth + 1)
  }
  walk(root, 0)
  return out
}

function defaultExpanded(root: ShapeNode, depth = 3): Set<string> {
  const s = new Set<string>()
  const walk = (n: ShapeNode, d: number) => {
    if (d >= depth || !n.children) return
    s.add(n.path)
    n.children.forEach((c) => walk(c, d + 1))
  }
  walk(root, 0)
  return s
}

export function ShapePanel({ shape }: { shape: ShapeNode }) {
  const [expanded, setExpanded] = useState(() => defaultExpanded(shape))
  const [lastShape, setLastShape] = useState(shape)
  if (lastShape !== shape) {
    setLastShape(shape)
    setExpanded(defaultExpanded(shape))
  }
  const rows = useMemo(() => flattenShape(shape, expanded), [shape, expanded])
  const toggle = (p: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  const all = () => {
    const s = new Set<string>()
    const walk = (n: ShapeNode) => {
      if (n.children) {
        s.add(n.path)
        n.children.forEach(walk)
      }
    }
    walk(shape)
    setExpanded(s)
  }
  return (
    <VirtualList
      items={rows}
      estimateSize={30}
      getKey={(r) => r.node.path}
      aria-label="Inferred shape"
      role="tree"
      header={
        <div className="flex items-center gap-3 border-b border-border px-4 py-1.5 text-xs">
          <span className="text-subtle">Array items are merged; optional = missing from some objects.</span>
          <button type="button" className="ml-auto text-muted hover:text-fg" onClick={all}>
            Expand all
          </button>
          <button type="button" className="text-muted hover:text-fg" onClick={() => setExpanded(new Set([shape.path]))}>
            Collapse
          </button>
        </div>
      }
      renderItem={(r) => {
        const n = r.node
        const optional = n.presentIn !== undefined && !n.required
        return (
          <div role="treeitem" aria-expanded={r.hasChildren ? expanded.has(n.path) : undefined} className="group flex min-w-0 items-center gap-2 border-b border-border/60 py-1 pr-2 text-sm hover:bg-surface-2/40" style={{ paddingLeft: 12 + r.depth * 16 }}>
            {r.hasChildren ? (
              <button type="button" onClick={() => toggle(n.path)} className="flex size-4 shrink-0 items-center justify-center text-subtle hover:text-fg" aria-label={expanded.has(n.path) ? 'Collapse' : 'Expand'}>
                {expanded.has(n.path) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <span className={cn('mono shrink-0 text-[12.5px]', n.key === '[]' ? 'text-subtle' : 'text-fg')} title={n.path}>
              {n.key}
              {optional && <span className="text-warn">?</span>}
            </span>
            <TypeBadges types={n.types} total={n.seen} />
            {n.presentIn !== undefined && n.parentCount! > 1 && (
              <span className={cn('shrink-0 text-2xs tabular', optional ? 'text-warn' : 'text-subtle')} title={`Present in ${n.presentIn} of ${n.parentCount} parent objects`}>
                {optional ? `${Math.round((n.presentIn / n.parentCount!) * 100)}%` : 'required'}
              </span>
            )}
            {n.truncatedKeys ? <span className="shrink-0 text-2xs text-warn">+{formatNumber(n.truncatedKeys)} more keys not tracked</span> : null}
            <span className="mono min-w-0 flex-1 truncate text-[12px] text-subtle">{n.examples.join(', ')}</span>
            <CopyButton value={n.path} label="Copy path" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
          </div>
        )
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Array statistics
// ---------------------------------------------------------------------------

function fmtNum(n: number) {
  if (Number.isInteger(n)) return formatNumber(n)
  return Math.abs(n) >= 1000 ? formatNumber(Math.round(n * 100) / 100) : String(+n.toPrecision(6))
}

function FieldRow({ f }: { f: ValueStats }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border px-4 py-2 md:grid-cols-[minmax(110px,22%)_1fr] md:gap-4">
      <div className="min-w-0">
        <p className="mono truncate text-[12.5px] font-medium text-fg" title={f.key}>
          {f.key}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-surface-2">
            <div className={cn('h-full', f.presence < 1 ? 'bg-warn' : 'bg-ok')} style={{ width: `${f.presence * 100}%` }} />
          </div>
          <span className={cn('text-2xs tabular', f.presence < 1 ? 'text-warn' : 'text-subtle')}>{(f.presence * 100).toFixed(f.presence < 1 && f.presence > 0.99 ? 1 : 0)}%</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <TypeBadges types={f.types} total={f.present} />
          {(f.distinct > 0 || f.distinctCapped) && (
            <span className="text-2xs text-subtle tabular">
              {f.distinctCapped ? `${formatNumber(f.distinct - 1)}+` : formatNumber(f.distinct)} distinct
            </span>
          )}
          {f.nulls > 0 && <span className="text-2xs text-subtle tabular">{formatNumber(f.nulls)} null</span>}
        </div>
        {f.numeric && (
          <p className="mono text-[12px] tabular text-muted" title={f.numeric.approx ? 'Some values exceed double precision; these statistics are floating-point approximations' : undefined}>
            {f.numeric.approx && <span className="mr-1 text-warn">≈</span>}
            min <span className="text-fg">{fmtNum(f.numeric.min)}</span> · max <span className="text-fg">{fmtNum(f.numeric.max)}</span> · mean <span className="text-fg">{fmtNum(f.numeric.mean)}</span>
          </p>
        )}
        {f.top && f.top.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {f.top.map((t) => (
              <span key={t.value} className="inline-flex max-w-full items-center gap-1 rounded-sm bg-surface px-1.5 text-[12px]">
                <span className="mono truncate text-fg">{t.value === '' ? '""' : t.value}</span>
                <span className="text-2xs text-subtle tabular">×{formatNumber(t.count)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function ArraysPanel({ arrays }: { arrays: ArrayStats[] }) {
  const [selected, setSelected] = useState(0)
  const a = arrays[Math.min(selected, arrays.length - 1)]
  if (!arrays.length) return <p className="px-4 py-6 text-sm text-muted">This response contains no arrays.</p>
  const items = a.fields.length ? a.fields : a.values ? [a.values] : []
  return (
    <VirtualList
      items={items}
      estimateSize={64}
      getKey={(f) => f.key}
      aria-label="Field statistics"
      header={
        <div className="border-b border-border">
          <div className="flex items-center gap-2 px-4 pt-2.5">
            <NativeSelect aria-label="Array" value={String(selected)} onChange={(e) => setSelected(Number(e.target.value))} className="mono min-w-0 flex-1 text-[12.5px]">
              {arrays.map((x, i) => (
                <option key={x.path} value={i}>
                  {x.path} ({formatNumber(x.totalItems)} items)
                </option>
              ))}
            </NativeSelect>
            <span className="shrink-0 text-2xs text-subtle">{arrays.length} array paths</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 px-4 py-2.5 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-2xs text-subtle">Arrays at path</dt>
              <dd className="mono tabular text-fg">{formatNumber(a.arrays)}</dd>
            </div>
            <div>
              <dt className="text-2xs text-subtle">Length</dt>
              <dd className="mono tabular text-fg">{a.minLength === a.maxLength ? formatNumber(a.minLength) : `${formatNumber(a.minLength)} – ${formatNumber(a.maxLength)}`}</dd>
            </div>
            <div>
              <dt className="text-2xs text-subtle">Total items</dt>
              <dd className="mono tabular text-fg">{formatNumber(a.totalItems)}</dd>
            </div>
            <div>
              <dt className="text-2xs text-subtle">Item types</dt>
              <dd>
                <TypeBadges types={a.itemTypes} total={a.totalItems} />
              </dd>
            </div>
          </dl>
          {a.truncatedFields && <p className="px-4 pb-2 text-2xs text-warn">More than 400 distinct field names — the rest are not tracked.</p>}
          {a.fields.length > 0 && a.values && <p className="px-4 pb-2 text-2xs text-subtle">Mixed array: field stats cover the object items; {formatNumber(a.values.present)} primitive items are summarised under “(value)” below.</p>}
        </div>
      }
      footer={
        a.fields.length > 0 && a.values ? (
          <FieldRow f={a.values} />
        ) : items.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">{a.totalItems ? 'Items are nested arrays — pick the inner path ([*]) above.' : 'Every array at this path is empty.'}</p>
        ) : null
      }
      renderItem={(f) => <FieldRow f={f} />}
    />
  )
}
