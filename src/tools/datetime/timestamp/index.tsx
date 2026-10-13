import { useDeferredValue, useMemo, useState } from 'react'
import { Clock, Pause, Play, RotateCcw } from 'lucide-react'
import { Temporal } from 'temporal-polyfill'
import { parseDateInput, type NumericUnit, type ParseResult } from '@/engines/datetime/parse'
import {
  calendarFacts,
  formatRelative,
  formatRelativePrecise,
  httpDate,
  isoUtc,
  isoWithOffset,
  rfc2822,
  rfc3339,
  unixSecondsFloor,
  unixValue,
  zonedText,
} from '@/engines/datetime/format'
import { localTimeZone } from '@/engines/datetime/zones'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { Toolbar, ToolbarField, ToolbarSeparator, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { EmptyState } from '@/components/tools/EmptyState'
import { KeyValueTable } from '@/components/tools/SettingsLayout'
import { ToolScrollBody } from '@/components/tools/ToolPage'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/common/CopyButton'
import { ZonePicker } from '../_shared/ZonePicker'
import { useNow } from '../_shared/useNow'
import { BatchView } from './BatchView'
import { cn } from '@/utils/cn'

type Mode = 'single' | 'batch'
type Assume = 'local' | 'utc' | 'zone'
type UnitChoice = NumericUnit | 'auto'

const SAMPLES = ['1710079200', '1710079200123', '2024-03-10T14:00:00Z', '2024-11-03T01:30:00', 'Sun, 10 Mar 2024 14:00:00 +0000']

export default function TimestampConverter() {
  const [mode, setMode] = usePersistentState<Mode>('mode', 'single')
  const [input, setInput] = usePersistentState('input', '')
  const [unit, setUnit] = usePersistentState<UnitChoice>('unit', 'auto')
  const [zone, setZone] = usePersistentState('zone', 'America/New_York')
  const [assume, setAssume] = usePersistentState<Assume>('assume', 'local')
  const [pausedAt, setPausedAt] = useState<number | null>(null)
  const localZone = useMemo(() => localTimeZone(), [])
  const now = useNow()
  const clock = pausedAt ?? now

  useIncomingInput((text) => {
    setMode(text.includes('\n') ? 'batch' : 'single')
    setInput(text)
  })

  const assumeZone = assume === 'utc' ? 'UTC' : assume === 'zone' ? zone : localZone
  const deferred = useDeferredValue(input)
  const parsed: ParseResult | null = useMemo(
    () => (deferred.trim() ? parseDateInput(deferred, { unit, zone: assumeZone }) : null),
    [deferred, unit, assumeZone],
  )

  const useNowValue = () => {
    setMode('single')
    setInput(String(Math.floor(clock / 1000)))
  }

  const toolbar = (
    <Toolbar>
      <Segmented
        aria-label="Mode"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: 'single', label: 'Single' },
          { value: 'batch', label: 'Batch' },
        ]}
      />
      <ToolbarSeparator />
      <ToolbarField label="Zone">
        <ZonePicker aria-label="Time zone for conversions" value={zone} onChange={setZone} atMs={clock} />
      </ToolbarField>
      <ToolbarField label="No offset →">
        <Select
          aria-label="How to read input without an offset"
          value={assume}
          onValueChange={setAssume}
          options={[
            { value: 'local', label: 'Local', description: `Read as wall time in ${localZone}` },
            { value: 'utc', label: 'UTC', description: 'Read as UTC' },
            { value: 'zone', label: 'Chosen zone', description: `Read as wall time in ${zone}` },
          ]}
        />
      </ToolbarField>
      {mode === 'batch' && (
        <ToolbarField label="Numbers">
          <UnitSelect unit={unit} setUnit={setUnit} />
        </ToolbarField>
      )}
      <ToolbarSpacer />
      <NowClock clock={clock} paused={pausedAt !== null} onToggle={() => setPausedAt(pausedAt === null ? now : null)} onUse={useNowValue} />
    </Toolbar>
  )

  if (mode === 'batch') {
    return (
      <>
        {toolbar}
        <BatchView unit={unit} assumeZone={assumeZone} zone={zone} />
      </>
    )
  }

  const ok = parsed?.ok ? parsed : null
  return (
    <>
      {toolbar}
      <div className="shrink-0 border-b border-border bg-bg px-3 py-3 md:px-4">
        <div className="flex items-center gap-2">
          <Input
            aria-label="Timestamp or date"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="1710079200 · 1710079200123 · 2024-03-10T14:00:00Z · Sun, 10 Mar 2024 14:00:00 GMT"
            aria-invalid={parsed?.ok === false}
            className="mono h-10 flex-1 text-[15px] tabular"
            autoFocus
          />
          {input && <IconButton label="Clear input" icon={<RotateCcw />} onClick={() => setInput('')} />}
        </div>
        <div className="mt-2 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          {ok ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="text-subtle">Detected</span>
                <Badge tone={ok.kind === 'browser' ? 'warn' : 'accent'}>{ok.label}</Badge>
              </span>
              {ok.kind === 'unix' && (
                <span className="flex items-center gap-1.5">
                  <span className="text-subtle">Unit</span>
                  <UnitSegmented unit={unit} setUnit={setUnit} auto={ok.autoUnit!} />
                </span>
              )}
              {ok.note && <span>{ok.note}</span>}
              {ok.kind === 'unix' && <span className="text-subtle">Auto: &lt; 10¹¹ s · &lt; 10¹⁴ ms · &lt; 10¹⁷ µs · else ns</span>}
            </>
          ) : !input ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-subtle">Try</span>
              {SAMPLES.map((s) => (
                <button key={s} type="button" onClick={() => setInput(s)} className="mono rounded-sm border border-border bg-surface px-1.5 py-0.5 text-2xs text-muted hover:border-border-strong hover:text-fg">
                  {s}
                </button>
              ))}
            </span>
          ) : null}
        </div>
      </div>
      {parsed && !parsed.ok && <ErrorDisplay error={parsed.message} title={parsed.kind === 'unix' ? 'Timestamp' : 'Date'} />}
      {ok?.warnings.map((w) => <ErrorDisplay key={w} error={w} severity="warning" />)}
      <ToolScrollBody>
        {ok ? (
          <Results epochNs={ok.epochNs} zone={zone} localZone={localZone} now={now} />
        ) : !input ? (
          <EmptyState
            icon={<Clock />}
            title="Paste a timestamp or date to convert it"
            description="Unix seconds, milliseconds, microseconds or nanoseconds (detected by size), ISO 8601, RFC 2822 and HTTP dates. Everything is converted locally."
            actions={
              <>
                <Button variant="primary" onClick={useNowValue}>
                  Use current time
                </Button>
                <Button onClick={() => setMode('batch')}>Convert a list</Button>
              </>
            }
          />
        ) : null}
      </ToolScrollBody>
      <StatusBar>
        <StatusItem label="Input">{ok ? ok.label : parsed ? <span className="text-danger">invalid</span> : '—'}</StatusItem>
        {ok && <StatusItem label="Unix">{unixSecondsFloor(ok.epochNs).toString()}</StatusItem>}
        <StatusSpacer />
        <StatusItem label="Local">{localZone}</StatusItem>
        <StatusItem label="Zone">{zone}</StatusItem>
        <Badge tone="neutral">Processed locally</Badge>
      </StatusBar>
    </>
  )
}

function UnitSelect({ unit, setUnit }: { unit: UnitChoice; setUnit: (u: UnitChoice) => void }) {
  return (
    <Select
      aria-label="Numeric unit"
      value={unit}
      onValueChange={setUnit}
      options={[
        { value: 'auto', label: 'Auto-detect', description: 'By magnitude' },
        { value: 's', label: 'Seconds' },
        { value: 'ms', label: 'Milliseconds' },
        { value: 'us', label: 'Microseconds' },
        { value: 'ns', label: 'Nanoseconds' },
      ]}
    />
  )
}

function UnitSegmented({ unit, setUnit, auto }: { unit: UnitChoice; setUnit: (u: UnitChoice) => void; auto: NumericUnit }) {
  const label = (u: NumericUnit) => (u === 'us' ? 'µs' : u)
  return (
    <Segmented
      aria-label="Numeric unit"
      size="xs"
      value={unit}
      onValueChange={setUnit}
      options={[
        { value: 'auto', label: `Auto (${label(auto)})` },
        ...(['s', 'ms', 'us', 'ns'] as NumericUnit[]).map((u) => ({ value: u, label: label(u) })),
      ]}
    />
  )
}

function NowClock({ clock, paused, onToggle, onUse }: { clock: number; paused: boolean; onToggle: () => void; onUse: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="text-xs text-subtle">Now</span>
      <span className={cn('mono min-w-[10ch] text-[13px] tabular', paused ? 'text-warn' : 'text-fg')} aria-live="off">
        {Math.floor(clock / 1000)}
      </span>
      <CopyButton value={() => String(Math.floor(clock / 1000))} label="Copy current Unix seconds" />
      <IconButton label={paused ? 'Resume clock' : 'Pause clock'} icon={paused ? <Play /> : <Pause />} onClick={onToggle} className={paused ? 'text-warn' : undefined} />
      <Button size="sm" onClick={onUse}>
        Use now
      </Button>
    </div>
  )
}

function Results({ epochNs, zone, localZone, now }: { epochNs: bigint; zone: string; localZone: string; now: number }) {
  const data = useMemo(() => {
    const safe = (f: () => string) => {
      try {
        return f()
      } catch {
        return '—'
      }
    }
    return {
      s: unixValue(epochNs, 's'),
      ms: unixValue(epochNs, 'ms'),
      isoUtc: safe(() => isoUtc(epochNs)),
      isoLocal: safe(() => isoWithOffset(epochNs, localZone)),
      rfc3339: safe(() => rfc3339(epochNs, zone)),
      rfc2822: safe(() => rfc2822(epochNs, zone)),
      http: safe(() => httpDate(epochNs)),
      local: zonedText(epochNs, localZone),
      utc: zonedText(epochNs, 'UTC'),
      zoned: zonedText(epochNs, zone),
      facts: calendarFacts(epochNs, zone),
      localFacts: calendarFacts(epochNs, localZone),
    }
  }, [epochNs, zone, localZone])
  const ms = Number(epochNs / 1_000_000n)
  const copy = (v: string, label: string) => <CopyButton value={v} label={`Copy ${label}`} size="icon-xs" />
  const sameDayInfo = data.localFacts.dayOfWeek === data.facts.dayOfWeek
  const year = Temporal.Instant.fromEpochNanoseconds(epochNs).toZonedDateTimeISO(zone).year
  const outOfCommon = year < 1900 || year > 2200

  return (
    <div className="mx-auto grid max-w-[1400px] gap-x-6 gap-y-5 p-3 md:p-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="eyebrow">Machine formats</h2>
        <KeyValueTable
          rows={[
            { key: 'Unix seconds', value: data.s, action: copy(data.s, 'Unix seconds') },
            { key: 'Unix milliseconds', value: data.ms, action: copy(data.ms, 'Unix milliseconds') },
            { key: 'ISO 8601 (UTC)', value: data.isoUtc, action: copy(data.isoUtc, 'ISO 8601 UTC') },
            { key: 'ISO 8601 (local offset)', hint: localZone, value: data.isoLocal, action: copy(data.isoLocal, 'ISO 8601 local') },
            { key: 'RFC 3339', hint: zone, value: data.rfc3339, action: copy(data.rfc3339, 'RFC 3339') },
            {
              key: 'RFC 2822',
              hint: zone,
              value: data.rfc2822,
              action: copy(data.rfc2822, 'RFC 2822'),
              tone: year < 1900 ? 'warn' : undefined,
            },
            { key: 'HTTP-date', hint: 'RFC 7231, always GMT', value: data.http, action: copy(data.http, 'HTTP date') },
          ]}
        />
        {outOfCommon && <p className="text-2xs text-warn">Year {year}: RFC 2822 requires years ≥ 1900, and many systems can’t store dates this far out.</p>}
      </section>
      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="eyebrow">Human-readable</h2>
        <KeyValueTable
          rows={[
            { key: 'Relative', hint: 'updates live', value: <span>{formatRelative(ms, now)} <span className="text-subtle">· {formatRelativePrecise(ms, now)}</span></span>, action: copy(formatRelative(ms, now), 'relative time') },
            { key: 'Local', hint: `${localZone} · ${data.local.longName}`, value: <ZonedValue z={data.local} />, action: copy(`${data.local.wall} ${data.local.abbreviation}`, 'local time') },
            { key: 'UTC', value: <ZonedValue z={data.utc} />, action: copy(`${data.utc.wall} UTC`, 'UTC time') },
            { key: zone, hint: data.zoned.longName, value: <ZonedValue z={data.zoned} />, action: copy(`${data.zoned.wall} ${data.zoned.abbreviation}`, `${zone} time`) },
          ]}
        />
        <h2 className="eyebrow mt-3">Calendar <span className="normal-case tracking-normal text-subtle">· in {zone}</span></h2>
        <KeyValueTable
          rows={[
            { key: 'Day of week', value: <>{data.facts.dayOfWeek}{!sameDayInfo && <span className="text-subtle"> ({data.localFacts.dayOfWeek} locally)</span>}</> },
            { key: 'ISO week', value: <>W{String(data.facts.isoWeek).padStart(2, '0')} <span className="text-subtle">· {data.facts.isoWeekDate}</span></>, action: copy(data.facts.isoWeekDate, 'ISO week date') },
            { key: 'Day of year', value: <>{data.facts.dayOfYear} <span className="text-subtle">of {data.facts.daysInYear} · Q{data.facts.quarter}</span></> },
            { key: 'Leap year', value: data.facts.leapYear ? `Yes — ${year} has 366 days` : `No — ${year} has 365 days`, tone: data.facts.leapYear ? 'ok' : 'muted' },
          ]}
        />
      </section>
    </div>
  )
}

function ZonedValue({ z }: { z: ReturnType<typeof zonedText> }) {
  return (
    <span>
      {z.wall} <span className="text-accent-text">{/^GMT[+-]/.test(z.abbreviation) ? z.offset : z.abbreviation}</span>
      {!/^GMT[+-]/.test(z.abbreviation) && <span className="text-subtle"> {z.offset}</span>}
    </span>
  )
}
