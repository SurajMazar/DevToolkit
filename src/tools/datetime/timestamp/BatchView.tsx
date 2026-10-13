import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import Papa from 'papaparse'
import { parseDateInput, type NumericUnit } from '@/engines/datetime/parse'
import { isoUtc, unixValue, wallClock } from '@/engines/datetime/format'
import { usePersistentState } from '@/hooks/usePersistentState'
import { InputEditorPane, OutputEditorPane } from '@/components/tools/EditorPane'
import { SplitPane } from '@/components/tools/SplitPane'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/common/CopyButton'
import { DownloadButton } from '@/components/common/DownloadButton'
import { formatNumber, pluralize } from '@/utils/format'
import { cn } from '@/utils/cn'

const SAMPLE = `1710079200
1710079200123
1710079200123456
2024-03-10T14:00:00Z
2024-11-03T01:30:00-04:00
Sun, 10 Mar 2024 14:00:00 +0000
Sun, 06 Nov 1994 08:49:37 GMT
-86400
not a date
2024-02-30`

/** Lines converted automatically; beyond this, conversion waits for an explicit click. */
const AUTO_LIMIT = 20_000

interface Row {
  line: number
  input: string
  ok: boolean
  kind: string
  iso: string
  s: string
  ms: string
  zoned: string
  error?: string
}

export function BatchView({ unit, assumeZone, zone }: { unit: NumericUnit | 'auto'; assumeZone: string; zone: string }) {
  const [text, setText] = usePersistentState('batch', '')
  const [view, setView] = usePersistentState<'table' | 'csv'>('batchView', 'table')
  const [forceAll, setForceAll] = useState(false)
  const deferred = useDeferredValue(text)
  const lines = useMemo(() => (deferred ? deferred.split(/\r?\n/) : []), [deferred])
  const nonEmpty = lines.filter((l) => l.trim()).length
  const tooMany = nonEmpty > AUTO_LIMIT && !forceAll

  const rows = useMemo<Row[]>(() => {
    if (tooMany) return []
    const out: Row[] = []
    const nowMs = Date.now()
    lines.forEach((raw, i) => {
      const input = raw.trim()
      if (!input) return
      const r = parseDateInput(input, { unit, zone: assumeZone, nowMs })
      if (!r.ok) {
        out.push({ line: i + 1, input, ok: false, kind: '', iso: '', s: '', ms: '', zoned: '', error: r.message })
        return
      }
      out.push({
        line: i + 1,
        input,
        ok: true,
        kind: r.label,
        iso: isoUtc(r.epochNs),
        s: unixValue(r.epochNs, 's'),
        ms: unixValue(r.epochNs, 'ms'),
        zoned: wallClock(r.epochNs, zone),
      })
    })
    return out
  }, [lines, unit, assumeZone, zone, tooMany])

  const errors = rows.filter((r) => !r.ok).length
  const csv = useMemo(
    () =>
      rows.length
        ? Papa.unparse({
            fields: ['line', 'input', 'detected', 'iso_8601_utc', 'unix_seconds', 'unix_ms', `local_${zone}`, 'error'],
            data: rows.map((r) => [r.line, r.input, r.kind, r.iso, r.s, r.ms, r.zoned, r.error ?? '']),
          })
        : '',
    [rows, zone],
  )

  const input = (
    <InputEditorPane
      value={text}
      onChange={(v) => {
        setText(v)
        setForceAll(false)
      }}
      sample={SAMPLE}
      title="Timestamps"
      placeholder="One timestamp or date per line…"
      path="timestamp-batch-input"
    />
  )

  const tableActions = (
    <>
      <CopyButton value={() => csv} label="Copy CSV" disabled={!csv} />
      <DownloadButton getContent={() => csv} filename="timestamps.csv" mime="text/csv;charset=utf-8" label="Download CSV" disabled={!csv} />
    </>
  )

  const output =
    view === 'csv' ? (
      <OutputEditorPane
        value={csv}
        title="CSV"
        filename="timestamps.csv"
        path="timestamp-batch-csv"
        meta={<ViewSwitch view={view} setView={setView} />}
        emptyState={!text.trim() ? <EmptyState compact title="Paste timestamps on the left — one per line." description="Each line is detected independently." /> : undefined}
      />
    ) : (
      <Pane>
        <PaneHeader title="Converted" meta={<ViewSwitch view={view} setView={setView} />} actions={tableActions} />
        {tooMany ? (
          <EmptyState
            title={`${formatNumber(nonEmpty)} lines`}
            description={`Large lists aren’t converted on every keystroke. Conversion runs in this tab and may take a moment.`}
            actions={
              <Button variant="primary" onClick={() => setForceAll(true)}>
                Convert all {formatNumber(nonEmpty)} lines
              </Button>
            }
          />
        ) : rows.length ? (
          <BatchTable rows={rows} zone={zone} />
        ) : (
          <EmptyState compact title="Paste timestamps on the left — one per line." description="Mix units and formats freely: each line is detected on its own." />
        )}
      </Pane>
    )

  return (
    <>
      <SplitPane id="timestamp-batch" initial={0.36} mobileTabs={['Input', 'Converted']}>
        {input}
        {output}
      </SplitPane>
      <StatusBar>
        <StatusItem label="Lines">{formatNumber(nonEmpty)}</StatusItem>
        <StatusItem label="Converted" tone={rows.length ? 'ok' : undefined}>
          {formatNumber(rows.length - errors)}
        </StatusItem>
        {errors > 0 && <StatusItem tone="danger">{pluralize(errors, 'error')}</StatusItem>}
        <StatusSpacer />
        <StatusItem label="Offset-less input in">{assumeZone}</StatusItem>
        <Badge tone="neutral">Processed locally</Badge>
      </StatusBar>
    </>
  )
}

function ViewSwitch({ view, setView }: { view: 'table' | 'csv'; setView: (v: 'table' | 'csv') => void }) {
  return (
    <Segmented
      aria-label="Output view"
      size="xs"
      value={view}
      onValueChange={setView}
      options={[
        { value: 'table', label: 'Table' },
        { value: 'csv', label: 'CSV' },
      ]}
    />
  )
}

const COLS = 'grid-cols-[44px_minmax(150px,1fr)_minmax(120px,0.7fr)_232px_minmax(150px,0.6fr)_minmax(176px,0.8fr)]'

function BatchTable({ rows, zone }: { rows: Row[]; zone: string }) {
  const parent = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 30, overscan: 12 })
  return (
    <div ref={parent} className="min-h-0 flex-1 overflow-auto">
      <div className="min-w-[920px]">
        <div className={cn('sticky top-0 z-10 grid border-b border-border bg-surface text-2xs font-medium uppercase tracking-wider text-subtle', COLS)}>
          <span className="px-2 py-1.5 text-right">#</span>
          <span className="px-2 py-1.5">Input</span>
          <span className="px-2 py-1.5">Detected</span>
          <span className="px-2 py-1.5">ISO 8601 UTC</span>
          <span className="px-2 py-1.5">Unix s</span>
          <span className="truncate px-2 py-1.5 normal-case tracking-normal">{zone}</span>
        </div>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((item) => {
            const r = rows[item.index]
            return (
              <div
                key={item.key}
                className={cn('group absolute left-0 top-0 grid w-full items-center border-b border-border/70 text-[12.5px] hover:bg-surface-2/50', COLS, !r.ok && 'bg-danger-soft/40')}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <span className="px-2 text-right text-2xs text-subtle tabular">{r.line}</span>
                <span className="mono truncate px-2 text-muted" title={r.input}>
                  {r.input}
                </span>
                {r.ok ? (
                  <>
                    <span className="truncate px-2 text-xs text-muted">{r.kind}</span>
                    <span className="mono flex items-center gap-1 truncate px-2">
                      <span className="truncate">{r.iso}</span>
                      <CopyButton value={r.iso} label="Copy ISO" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
                    </span>
                    <span className="mono truncate px-2 tabular">{r.s}</span>
                    <span className="mono truncate px-2">{r.zoned}</span>
                  </>
                ) : (
                  <span className="col-span-4 truncate px-2 text-xs text-danger" title={r.error}>
                    {r.error}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
