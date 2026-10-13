import { useMemo } from 'react'
import { ArrowUpToLine, Clock3, Plus, TriangleAlert, X } from 'lucide-react'
import { Temporal } from 'temporal-polyfill'
import { dayDelta, dayTimeline, overlapRanges, resolveWallTime, type Disambiguation } from '@/engines/datetime/convert'
import { formatUtcOffsetShort, localTimeZone, zoneCity, zoneSnapshot, type ZoneSnapshot } from '@/engines/datetime/zones'
import { formatRelative } from '@/engines/datetime/format'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarField, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { EmptyState } from '@/components/tools/EmptyState'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/common/CopyButton'
import { ZonePicker } from '../_shared/ZonePicker'
import { DateTimeInput } from '../_shared/DateTimeInput'
import { parseInputValue, toInputValue, WEEKDAY_SHORT } from '../_shared/util'
import { useNow } from '../_shared/useNow'
import { cn } from '@/utils/cn'

const DEFAULT_ZONES = ['UTC', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

export default function TimeZoneConverter() {
  const localZone = useMemo(() => localTimeZone(), [])
  const now = useNow(false, 30_000)
  const [source, setSource] = usePersistentState('source', localZone)
  const [wall, setWall] = usePersistentState('wall', () => toInputValue(Date.now(), localZone))
  const [zones, setZones] = usePersistentState<string[]>('zones', DEFAULT_ZONES)
  const [disamb, setDisamb] = usePersistentState<Disambiguation>('disambiguation', 'compatible')
  const [work, setWork] = usePersistentState<string>('workHours', '9-17')
  const [workStart, workEnd] = work.split('-').map(Number)

  const plain = parseInputValue(wall)
  const resolution = useMemo(() => (plain ? resolveWallTime(plain, source, disamb) : null), [plain?.toString(), source, disamb]) // eslint-disable-line react-hooks/exhaustive-deps
  const selected = resolution?.chosen ?? null
  const targets = zones.filter((z) => z !== source)
  const allZones = [source, ...targets]

  const snapshots = useMemo(() => {
    if (!selected) return []
    return allZones.map((zone) => ({ zone, snap: zoneSnapshot(selected.epochMilliseconds, zone), z: selected.withTimeZone(zone) }))
  }, [selected?.epochNanoseconds, allZones.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const timeline = useMemo(() => (selected ? dayTimeline(selected, allZones, workStart, workEnd) : null), [selected?.epochNanoseconds, allZones.join('|'), workStart, workEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  const addZone = (z: string) => {
    if (z === source || zones.includes(z)) return
    setZones([...zones, z])
  }
  const removeZone = (z: string) => setZones(zones.filter((x) => x !== z))
  const makeSource = (z: string) => {
    if (!selected) return
    const next = selected.withTimeZone(z)
    setZones([source, ...zones.filter((x) => x !== z && x !== source)])
    setSource(z)
    setWall(next.toPlainDateTime().toString({ smallestUnit: 'second' }))
  }
  const changeSource = (z: string) => {
    // Keep the same wall-clock reading, re-interpreted in the new zone.
    setSource(z)
    setZones(zones.filter((x) => x !== z))
  }

  return (
    <>
      <Toolbar>
        <ToolbarField label="Time">
          <DateTimeInput aria-label="Source date and time" value={wall} onChange={setWall} aria-invalid={!plain} className="h-7 w-[250px]" />
        </ToolbarField>
        <ToolbarField label="in">
          <ZonePicker aria-label="Source time zone" value={source} onChange={changeSource} atMs={selected?.epochMilliseconds ?? now} />
        </ToolbarField>
        <Button size="sm" variant="ghost" onClick={() => setWall(toInputValue(Date.now(), source))}>
          <Clock3 /> Now
        </Button>
        <ToolbarSpacer />
        <ToolbarField label="Skipped/repeated times">
          <Select
            aria-label="Disambiguation for skipped or repeated wall times"
            value={disamb}
            onValueChange={setDisamb}
            options={[
              { value: 'compatible', label: 'Compatible', description: 'Gap → later, repeat → earlier (Temporal/JS default)' },
              { value: 'earlier', label: 'Earlier', description: 'Use the offset before the change' },
              { value: 'later', label: 'Later', description: 'Use the offset after the change' },
              { value: 'reject', label: 'Reject', description: 'Show an error instead of guessing' },
            ]}
          />
        </ToolbarField>
      </Toolbar>
      {!plain && <ErrorDisplay error="Enter a valid date and time." />}
      {resolution && resolution.status !== 'ok' && (
        <div role="alert" className="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-2 border-b border-warn/25 bg-warn-soft px-3 py-2 text-sm md:px-4">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          <p className="min-w-0 flex-1">
            <span className="font-medium">{resolution.status === 'gap' ? 'Nonexistent local time. ' : 'Ambiguous local time. '}</span>
            {resolution.explanation}
          </p>
          <Segmented
            aria-label="Choose interpretation"
            size="xs"
            value={disamb === 'compatible' ? (resolution.status === 'gap' ? 'later' : 'earlier') : disamb}
            onValueChange={(v) => setDisamb(v as Disambiguation)}
            options={[
              { value: 'earlier', label: `Earlier ${resolution.earlier.offset}` },
              { value: 'later', label: `Later ${resolution.later.offset}` },
              { value: 'reject', label: 'Reject' },
            ]}
          />
        </div>
      )}
      {resolution && !selected && resolution.status !== 'ok' && <ErrorDisplay error="Rejected: this wall time doesn’t map to a single instant. Pick Earlier or Later, or change the time." />}
      <div className="min-h-0 flex-1 overflow-y-auto bg-workspace">
        <Pane className="flex-none">
          <PaneHeader
            title="Zones"
            meta={`${allZones.length} zones`}
            actions={
              <ZonePicker
                aria-label="Add a time zone"
                value=""
                selected={allZones}
                onChange={addZone}
                atMs={selected?.epochMilliseconds ?? now}
                align="end"
                trigger={
                  <Button size="xs" variant="ghost" aria-label="Add a time zone">
                    <Plus /> Add zone
                  </Button>
                }
              />
            }
          />
          {selected ? (
            <div role="table" aria-label="Time in each zone" className="text-sm">
              <div role="row" className="hidden grid-cols-[minmax(180px,1.2fr)_minmax(170px,1fr)_minmax(120px,0.7fr)_minmax(100px,0.5fr)_minmax(220px,1.3fr)_88px] border-b border-border bg-surface/60 text-2xs font-medium uppercase tracking-wider text-subtle md:grid">
                {['Zone', 'Local time', 'Offset', 'DST', 'Next change', ''].map((h, i) => (
                  <span role="columnheader" key={i} className="px-3 py-1.5">
                    {h}
                  </span>
                ))}
              </div>
              {snapshots.map(({ zone, snap, z }, i) => (
                <ZoneRow
                  key={zone}
                  zone={zone}
                  snap={snap}
                  z={z}
                  isSource={i === 0}
                  delta={dayDelta(z, selected)}
                  now={selected.epochMilliseconds}
                  isLocal={zone === localZone}
                  onRemove={() => removeZone(zone)}
                  onMakeSource={() => makeSource(zone)}
                />
              ))}
              {targets.length === 0 && (
                <EmptyState compact title="Add zones to compare" description="Search by city (Mumbai), abbreviation (PST) or offset (+5:30)." />
              )}
            </div>
          ) : (
            <EmptyState compact title="No instant selected" description="Fix the time above to see it in other zones." />
          )}
        </Pane>
        {timeline && (
          <Pane className="flex-none border-t border-border">
            <PaneHeader
              title="Day timeline"
              meta={`${source} day: ${timeline.hours} hours${timeline.hours !== 24 ? ' (DST change)' : ''} · click an hour to select it`}
              actions={
                <label className="flex items-center gap-1.5 text-2xs text-subtle">
                  Working hours
                  <Select
                    aria-label="Working hours"
                    value={work}
                    onValueChange={setWork}
                    options={['8-16', '9-17', '9-18', '10-18', '10-19'].map((v) => ({ value: v, label: v.replace('-', '–') }))}
                  />
                </label>
              }
            />
            <Timeline timeline={timeline} onPick={(ms) => setWall(toInputValue(ms, source))} />
          </Pane>
        )}
      </div>
      <StatusBar>
        <StatusItem label="UTC">{selected ? selected.toInstant().toString({ smallestUnit: 'second' }) : '—'}</StatusItem>
        <StatusItem label="Unix">{selected ? Math.floor(selected.epochMilliseconds / 1000) : '—'}</StatusItem>
        {resolution && resolution.status !== 'ok' && <StatusItem tone="mod">{resolution.status === 'gap' ? 'Skipped wall time' : 'Repeated wall time'}</StatusItem>}
        <StatusSpacer />
        <StatusItem label="Zones">{allZones.length}</StatusItem>
        <Badge tone="neutral">Zones saved locally</Badge>
      </StatusBar>
    </>
  )
}

function ZoneRow({
  zone,
  snap,
  z,
  isSource,
  delta,
  now,
  isLocal,
  onRemove,
  onMakeSource,
}: {
  zone: string
  snap: ZoneSnapshot
  z: Temporal.ZonedDateTime
  isSource: boolean
  delta: number
  now: number
  isLocal: boolean
  onRemove: () => void
  onMakeSource: () => void
}) {
  const time = `${pad(z.hour)}:${pad(z.minute)}:${pad(z.second)}`
  const date = `${WEEKDAY_SHORT[z.dayOfWeek - 1]} ${z.day} ${MONTHS[z.month - 1]} ${z.year}`
  const next = snap.next
  const abbr = /^GMT[+-]/.test(snap.abbreviation) ? '' : snap.abbreviation
  return (
    <div
      role="row"
      className={cn(
        'group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 md:grid-cols-[minmax(180px,1.2fr)_minmax(170px,1fr)_minmax(120px,0.7fr)_minmax(100px,0.5fr)_minmax(220px,1.3fr)_88px] md:gap-0 md:px-0 md:py-0',
        isSource && 'bg-accent-soft/60',
      )}
    >
      <div role="cell" className="min-w-0 md:px-3 md:py-2">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-fg">{zoneCity(zone)}</span>
          {isSource && <Badge tone="accent">Source</Badge>}
          {isLocal && <Badge>Local</Badge>}
        </div>
        <div className="truncate text-2xs text-subtle">{zone}</div>
      </div>
      <div role="cell" className="row-span-2 text-right md:row-span-1 md:px-3 md:py-2 md:text-left">
        <div className="mono text-[17px] leading-6 text-fg tabular">{time}</div>
        <div className="flex items-center justify-end gap-1.5 text-2xs text-muted md:justify-start">
          {date}
          {delta !== 0 && <Badge tone={delta > 0 ? 'mod' : 'del'}>{delta > 0 ? `+${delta}` : delta} day</Badge>}
        </div>
      </div>
      <div role="cell" className="mono text-xs text-muted md:px-3 md:py-2">
        <span className="text-fg">{formatUtcOffsetShort(snap.offsetNs)}</span>
        {abbr && <span className="ml-1.5 text-accent-text">{abbr}</span>}
        <span className="ml-2 md:hidden">{snap.isDst ? '· DST' : ''}</span>
      </div>
      <div role="cell" className="hidden md:block md:px-3 md:py-2">
        {snap.isDst ? <Badge tone="mod">DST</Badge> : snap.observesDst ? <Badge>Standard</Badge> : <span className="text-2xs text-subtle">No DST</span>}
      </div>
      <div role="cell" className="col-span-2 text-2xs text-muted md:col-span-1 md:px-3 md:py-2">
        {next ? (
          <>
            <span className="mono text-fg/90">{next.wallBefore.slice(0, 10)}</span>{' '}
            <span className="mono">
              {next.wallBefore.slice(11)}→{next.wallAfter.slice(11)}
            </span>{' '}
            <span className={next.deltaMinutes > 0 ? 'text-mod' : 'text-accent-text'}>
              ({next.deltaMinutes > 0 ? '+' : '−'}
              {Math.abs(next.deltaMinutes) % 60 ? `${Math.abs(next.deltaMinutes)} min` : `${Math.abs(next.deltaMinutes) / 60} h`})
            </span>
            <span className="block text-subtle">
              {next.abbrBefore !== next.abbrAfter && !/GMT/.test(next.abbrBefore + next.abbrAfter) ? `${next.abbrBefore} → ${next.abbrAfter} · ` : ''}
              {formatRelative(next.epochMs, now)} from the selected time
            </span>
          </>
        ) : (
          <span className="text-subtle">No upcoming change</span>
        )}
      </div>
      <div role="cell" className="col-span-2 flex items-center justify-end gap-0.5 md:col-span-1 md:pr-2 md:opacity-60 md:group-hover:opacity-100 md:focus-within:opacity-100">
        <CopyButton value={z.toString({ smallestUnit: 'second' })} label={`Copy ${zone} time (RFC 9557)`} size="icon-xs" />
        {!isSource && <IconButton label="Make this the source zone" icon={<ArrowUpToLine />} size="icon-xs" onClick={onMakeSource} />}
        {!isSource && <IconButton label={`Remove ${zone}`} icon={<X />} size="icon-xs" onClick={onRemove} />}
      </div>
    </div>
  )
}

function Timeline({ timeline, onPick }: { timeline: NonNullable<ReturnType<typeof dayTimeline>>; onPick: (epochMs: number) => void }) {
  const ranges = overlapRanges(timeline.overlap)
  const markerPct = (timeline.markerPosition / timeline.hours) * 100
  const fmtRange = ([a, b]: [number, number]) => {
    const r = timeline.rows[0].cells
    const end = b < r.length ? r[b] : null
    return `${pad(r[a].hour)}:${pad(r[a].minute)}–${end ? `${pad(end.hour)}:${pad(end.minute)}` : '24:00'}`
  }
  return (
    <div className="overflow-x-auto px-3 py-3 md:px-4">
      <div className="min-w-[760px]">
        <div className="mb-2 flex items-center gap-2 text-2xs text-muted">
          <span className="inline-block size-2.5 rounded-xs bg-accent" /> everyone in working hours
          <span className="ml-3 inline-block size-2.5 rounded-xs bg-ok-soft ring-1 ring-ok/40" /> working hours
          <span className="ml-3 inline-block size-2.5 rounded-xs bg-surface-2" /> early / evening
          <span className="ml-3 inline-block size-2.5 rounded-xs border border-border bg-bg" /> night
          <span className="ml-auto">
            {ranges.length ? (
              <>
                Overlap (source time): <span className="mono text-fg">{ranges.map(fmtRange).join(', ')}</span>
              </>
            ) : (
              <span className="text-warn">No hour where every zone is within working hours.</span>
            )}
          </span>
        </div>
        <div className="relative">
          <div className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-y-1">
            <span className="pr-2 text-2xs text-subtle">All in hours</span>
            <div className="grid h-2 gap-px" style={{ gridTemplateColumns: `repeat(${timeline.hours}, minmax(0, 1fr))` }}>
              {timeline.overlap.map((v, i) => (
                <span key={i} className={cn('rounded-[2px]', v ? 'bg-accent' : 'bg-transparent')} />
              ))}
            </div>
            {timeline.rows.map((row, ri) => (
              <TimelineRow key={row.zone} row={row} hours={timeline.hours} isSource={ri === 0} onPick={(i) => onPick(timeline.startEpochMs + i * 3_600_000)} />
            ))}
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-[150px] right-0">
            <span className="absolute inset-y-[-4px] w-0.5 rounded-full bg-accent" style={{ left: `calc(${markerPct}% - 1px)` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function TimelineRow({ row, hours, isSource, onPick }: { row: ReturnType<typeof dayTimeline>['rows'][number]; hours: number; isSource: boolean; onPick: (i: number) => void }) {
  return (
    <>
      <span className={cn('truncate pr-2 text-xs', isSource ? 'font-medium text-fg' : 'text-muted')} title={row.zone}>
        {zoneCity(row.zone)}
      </span>
      <div className="grid h-8 gap-px" style={{ gridTemplateColumns: `repeat(${hours}, minmax(0, 1fr))` }}>
        {row.cells.map((c, i) => {
          const midnight = c.hour === 0 && i > 0
          return (
            <button
              type="button"
              key={i}
              onClick={() => onPick(i)}
              aria-label={`${zoneCity(row.zone)} ${pad(c.hour)}:${pad(c.minute)}${c.dayDelta ? ` (${c.dayDelta > 0 ? '+' : ''}${c.dayDelta} day)` : ''}`}
              className={cn(
                'mono relative flex flex-col items-center justify-center rounded-[3px] text-[10.5px] leading-3 tabular transition-colors hover:outline hover:outline-1 hover:outline-border-strong focus-visible:outline-2 focus-visible:outline-ring',
                c.kind === 'work' ? 'bg-ok-soft text-ok' : c.kind === 'edge' ? 'bg-surface-2 text-muted' : 'border border-border/60 bg-bg text-subtle',
                midnight && 'ring-1 ring-inset ring-border-strong',
              )}
            >
              <span>{c.hour}</span>
              {c.minute !== 0 && <span className="text-[9px] opacity-70">:{pad(c.minute)}</span>}
              {midnight && <span className="absolute -top-px left-0.5 text-[8px] leading-none text-subtle">{c.dayDelta > 0 ? '+1' : c.dayDelta < 0 ? '−1' : ''}</span>}
            </button>
          )
        })}
      </div>
    </>
  )
}
