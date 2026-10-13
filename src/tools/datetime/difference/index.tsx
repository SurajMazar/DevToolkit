import { useMemo } from 'react'
import { ArrowDownUp, CalendarRange, Clock3, Info, TriangleAlert } from 'lucide-react'
import { Temporal } from 'temporal-polyfill'
import { addDuration, difference, DURATION_UNITS, EMPTY_DURATION, humanizeDuration, type DurationInput, type LargestUnit } from '@/engines/datetime/difference'
import { resolveWallTime } from '@/engines/datetime/convert'
import { localTimeZone } from '@/engines/datetime/zones'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Toolbar, ToolbarField, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Select } from '@/components/ui/select'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/common/CopyButton'
import { ZonePicker } from '../_shared/ZonePicker'
import { DateTimeInput } from '../_shared/DateTimeInput'
import { parseInputValue, toInputValue, WEEKDAY_SHORT } from '../_shared/util'
import { cn } from '@/utils/cn'

const UNIT_OPTIONS: { value: LargestUnit; label: string }[] = [
  { value: 'years', label: 'Years' },
  { value: 'months', label: 'Months' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'days', label: 'Days' },
  { value: 'hours', label: 'Hours' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'seconds', label: 'Seconds' },
]

const TOTAL_LABELS: Record<(typeof DURATION_UNITS)[number], string> = {
  years: 'Years',
  months: 'Months',
  weeks: 'Weeks',
  days: 'Days',
  hours: 'Hours',
  minutes: 'Minutes',
  seconds: 'Seconds',
  milliseconds: 'Milliseconds',
}

const DURATION_FIELDS: { key: keyof DurationInput; label: string; short: string }[] = [
  { key: 'years', label: 'Years', short: 'Y' },
  { key: 'months', label: 'Months', short: 'M' },
  { key: 'weeks', label: 'Weeks', short: 'W' },
  { key: 'days', label: 'Days', short: 'D' },
  { key: 'hours', label: 'Hours', short: 'h' },
  { key: 'minutes', label: 'Minutes', short: 'm' },
  { key: 'seconds', label: 'Seconds', short: 's' },
]

function fmtTotal(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-US')
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

/** Resolves a datetime-local value in a zone; gaps move forward, overlaps take the first occurrence. */
function resolve(value: string, zone: string) {
  const p = parseInputValue(value)
  if (!p) return { z: null, note: null }
  const r = resolveWallTime(p, zone, 'compatible')
  return { z: r.chosen, note: r.status === 'ok' ? null : r.explanation }
}

export default function DateDifference() {
  const localZone = useMemo(() => localTimeZone(), [])
  const nowMs = Date.now()
  const [zone, setZone] = usePersistentState('zone', localZone)
  const [start, setStart] = usePersistentState('start', () => toInputValue(nowMs, localZone).slice(0, 10) + 'T09:00:00')
  const [end, setEnd] = usePersistentState('end', () => Temporal.PlainDate.from(toInputValue(nowMs, localZone).slice(0, 10)).add({ months: 1 }).toString() + 'T17:30:00')
  const [largest, setLargest] = usePersistentState<LargestUnit>('largest', 'years')
  const [base, setBase] = usePersistentState('base', () => Temporal.PlainDate.from(toInputValue(nowMs, localZone).slice(0, 10)).with({ day: 31, month: 1 }).toString() + 'T10:00:00')
  const [op, setOp] = usePersistentState<'add' | 'subtract'>('op', 'add')
  const [overflow, setOverflow] = usePersistentState<'constrain' | 'reject'>('overflow', 'constrain')
  const [dur, setDur] = usePersistentState<DurationInput>('duration', { ...EMPTY_DURATION, months: 1 })

  const s = resolve(start, zone)
  const e = resolve(end, zone)
  const diff = useMemo(() => (s.z && e.z ? difference(s.z, e.z, largest) : null), [s.z, e.z, largest])
  const b = resolve(base, zone)
  const added = useMemo(() => (b.z ? addDuration(b.z, dur, op, overflow) : null), [b.z, dur, op, overflow])

  const nowValue = () => toInputValue(Date.now(), zone)
  const loadDstSample = () => {
    setZone('America/New_York')
    setStart('2024-03-09T12:00:00')
    setEnd('2024-03-11T12:00:00')
    setBase('2024-01-31T10:00:00')
    setDur({ ...EMPTY_DURATION, months: 1 })
    setOp('add')
  }

  return (
    <>
      <Toolbar>
        <ToolbarField label="Zone">
          <ZonePicker aria-label="Time zone for both dates" value={zone} onChange={setZone} atMs={s.z?.epochMilliseconds ?? nowMs} />
        </ToolbarField>
        <ToolbarField label="Largest unit">
          <Select aria-label="Largest unit" value={largest} onValueChange={setLargest} options={UNIT_OPTIONS} />
        </ToolbarField>
        <ToolbarSpacer />
        <Button variant="ghost" size="sm" onClick={loadDstSample}>
          Load DST example
        </Button>
      </Toolbar>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-workspace lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:overflow-hidden">
        <Pane className="flex-none lg:min-h-0 lg:border-r lg:border-border">
          <PaneHeader title="Difference" meta={diff ? diff.iso : undefined} actions={diff && <CopyButton value={diff.iso} label="Copy ISO 8601 duration" />} />
          <div className="flex flex-col gap-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
              <DateRow label="Start" value={start} onChange={setStart} onNow={() => setStart(nowValue())} z={s.z} />
              <div className="col-start-2 -my-1 flex items-center gap-2">
                <IconButton
                  label="Swap start and end"
                  icon={<ArrowDownUp />}
                  size="icon-xs"
                  onClick={() => {
                    setStart(end)
                    setEnd(start)
                  }}
                />
                {diff && <DirectionBadge sign={diff.sign} />}
              </div>
              <DateRow label="End" value={end} onChange={setEnd} onNow={() => setEnd(nowValue())} z={e.z} />
            </div>
            {[s.note, e.note].filter(Boolean).map((n) => (
              <Note key={n} tone="warn">
                {n} Using the later reading.
              </Note>
            ))}
            {!s.z || !e.z ? (
              <ErrorDisplay error={`Enter a valid ${!s.z ? 'start' : 'end'} date and time.`} className="rounded-md border" />
            ) : (
              diff && (
                <>
                  <div className="rounded-lg border border-border bg-surface/50 px-4 py-3">
                    <p className="eyebrow mb-1">Calendar difference</p>
                    <p className="mono text-lg leading-7 text-fg">{humanizeDuration(diff.duration)}</p>
                    <p className="mt-1 text-xs text-muted">
                      {diff.sign < 0 ? 'End is before start — the duration is negative (' : ''}
                      <span className="mono">{diff.iso}</span>
                      {diff.sign < 0 ? ')' : ''} · largest unit {largest}
                    </p>
                  </div>
                  <section>
                    <h3 className="eyebrow mb-2">Totals</h3>
                    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
                      {DURATION_UNITS.map((u) => (
                        <div key={u} className="group flex flex-col gap-0.5 bg-workspace px-3 py-2">
                          <span className="flex items-center justify-between text-2xs text-subtle">
                            {TOTAL_LABELS[u]}
                            <CopyButton value={String(diff.totals[u])} label={`Copy total ${u}`} size="icon-xs" className="-my-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
                          </span>
                          <span className="mono truncate text-sm tabular" title={String(diff.totals[u])}>
                            {fmtTotal(diff.totals[u])}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1.5 text-2xs text-subtle">Years, months and days are calendar-aware (real month lengths; a 23-hour DST day counts as one day). Hours and smaller are exact elapsed time.</p>
                  </section>
                  <section className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    <Fact label="Business days" value={diff.businessDays.toLocaleString('en-US')} hint="Mon–Fri from the earlier date up to (not including) the later date. Holidays are not excluded." />
                    <Fact label="Calendar days" value={diff.calendarDays.toLocaleString('en-US')} hint="Dates crossed, ignoring time of day." />
                    <Fact label="Elapsed" value={`${fmtTotal(Math.abs(diff.elapsedMs) / 3_600_000)} h`} hint="Exact time between the two instants." />
                    <Fact label="Weekends" value={(diff.calendarDays - diff.businessDays).toLocaleString('en-US')} hint="Sat–Sun dates in the same span." />
                  </section>
                  <DstSection diff={diff} zone={zone} />
                </>
              )
            )}
          </div>
        </Pane>
        <Pane className="flex-none border-t border-border lg:min-h-0 lg:border-t-0">
          <PaneHeader title="Add or subtract" actions={added?.ok && <CopyButton value={added.result.toString()} label="Copy result (RFC 9557)" />} />
          <div className="flex flex-col gap-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
              <DateRow label="Date" value={base} onChange={setBase} onNow={() => setBase(nowValue())} z={b.z} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                aria-label="Operation"
                value={op}
                onValueChange={setOp}
                options={[
                  { value: 'add', label: 'Add' },
                  { value: 'subtract', label: 'Subtract' },
                ]}
              />
              <span className="text-xs text-subtle">Month-end overflow</span>
              <Segmented
                aria-label="Month-end overflow"
                value={overflow}
                onValueChange={setOverflow}
                options={[
                  { value: 'constrain', label: 'Clamp' },
                  { value: 'reject', label: 'Reject' },
                ]}
              />
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {DURATION_FIELDS.map((f) => (
                <label key={f.key} className="flex min-w-0 flex-col gap-1">
                  <span className="text-2xs text-subtle">{f.label}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={dur[f.key] === 0 ? '' : String(dur[f.key])}
                    placeholder="0"
                    aria-label={f.label}
                    onChange={(ev) => {
                      const v = ev.target.value === '' ? 0 : Number(ev.target.value)
                      setDur({ ...dur, [f.key]: Number.isFinite(v) ? v : 0 })
                    }}
                    className="mono tabular px-2"
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="xs" onClick={() => setDur({ ...EMPTY_DURATION })}>
                Clear duration
              </Button>
              {[
                ['+1 month', { ...EMPTY_DURATION, months: 1 }],
                ['+90 days', { ...EMPTY_DURATION, days: 90 }],
                ['+1 year', { ...EMPTY_DURATION, years: 1 }],
                ['+24 h', { ...EMPTY_DURATION, hours: 24 }],
              ].map(([label, d]) => (
                <Button
                  key={label as string}
                  variant="ghost"
                  size="xs"
                  className="mono"
                  onClick={() => {
                    setOp('add')
                    setDur(d as DurationInput)
                  }}
                >
                  {label as string}
                </Button>
              ))}
            </div>
            {b.note && <Note tone="warn">{b.note} Using the later reading.</Note>}
            {!b.z ? (
              <ErrorDisplay error="Enter a valid date and time." className="rounded-md border" />
            ) : added && !added.ok ? (
              <ErrorDisplay error={added.message} className="rounded-md border" />
            ) : (
              added?.ok && (
                <>
                  <div className="rounded-lg border border-border bg-surface/50 px-4 py-3">
                    <p className="eyebrow mb-1">Result</p>
                    <p className="mono text-lg leading-7">
                      {added.result.toPlainDate().toString()} {added.result.toPlainTime().toString({ smallestUnit: 'second' })}
                      <span className="ml-2 text-sm text-muted">{WEEKDAY_SHORT[added.result.dayOfWeek - 1]}</span>
                    </p>
                    <p className="mono mt-1 text-xs text-muted">{added.result.toString()}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="xs" onClick={() => setEnd(added.result.toPlainDateTime().toString({ smallestUnit: 'second' }))}>
                        Use as End
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setBase(added.result.toPlainDateTime().toString({ smallestUnit: 'second' }))}>
                        Use as new date
                      </Button>
                    </div>
                  </div>
                  {added.notes.map((n) => (
                    <Note key={n} tone={added.clamped || added.dstShift ? 'warn' : 'info'}>
                      {n}
                    </Note>
                  ))}
                </>
              )
            )}
            <p className="text-2xs leading-4 text-subtle">
              Order of application: years and months first (the day is clamped to the month’s last day when it doesn’t exist, e.g. Jan 31 + 1 month = Feb 29 in 2024), then weeks and days on the wall clock, then hours, minutes and seconds as exact time.
            </p>
          </div>
        </Pane>
      </div>
      <StatusBar>
        {diff ? (
          <>
            <StatusItem label="Direction" tone={diff.sign < 0 ? 'mod' : undefined}>
              {diff.sign > 0 ? 'forward' : diff.sign < 0 ? 'backward' : 'same instant'}
            </StatusItem>
            <StatusItem label="Days">{fmtTotal(diff.totals.days)}</StatusItem>
            <StatusItem label="DST changes">{diff.transitions.length}</StatusItem>
          </>
        ) : (
          <StatusItem label="Difference">—</StatusItem>
        )}
        <StatusSpacer />
        <StatusItem label="Zone">{zone}</StatusItem>
        <Badge tone="neutral">Temporal · processed locally</Badge>
      </StatusBar>
    </>
  )
}

function DateRow({ label, value, onChange, onNow, z }: { label: string; value: string; onChange: (v: string) => void; onNow: () => void; z: Temporal.ZonedDateTime | null }) {
  return (
    <>
      <span className="text-xs text-muted">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <DateTimeInput aria-label={`${label} date and time`} value={value} onChange={onChange} aria-invalid={!z} className="w-[230px]" />
        <Button size="sm" variant="ghost" onClick={onNow}>
          <Clock3 /> Now
        </Button>
        {z && (
          <span className="mono text-2xs text-subtle">
            {WEEKDAY_SHORT[z.dayOfWeek - 1]} · {z.offset}
          </span>
        )}
      </div>
    </>
  )
}

function DirectionBadge({ sign }: { sign: -1 | 0 | 1 }) {
  if (sign === 0) return <Badge>Same instant</Badge>
  return sign > 0 ? <Badge tone="accent">End is after start</Badge> : <Badge tone="mod">End is before start</Badge>
}

function Fact({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5">
      <span className="text-muted" title={hint}>
        {label}
        <span className="block text-2xs text-subtle">{hint}</span>
      </span>
      <span className="mono shrink-0 tabular">{value}</span>
    </div>
  )
}

function Note({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  const Icon = tone === 'warn' ? TriangleAlert : Info
  return (
    <div className={cn('flex gap-2 rounded-md border px-3 py-2 text-xs leading-5', tone === 'warn' ? 'border-warn/25 bg-warn-soft' : 'border-border bg-surface')}>
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', tone === 'warn' ? 'text-warn' : 'text-subtle')} />
      <span className="text-fg/90">{children}</span>
    </div>
  )
}

function DstSection({ diff, zone }: { diff: ReturnType<typeof difference>; zone: string }) {
  if (!diff.transitions.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-subtle">
        <CalendarRange className="size-3.5" /> No DST or offset changes in {zone} during this interval — every day is 24 hours.
      </p>
    )
  }
  const shown = diff.transitions.slice(0, 6)
  const more = diff.transitions.length - shown.length
  return (
    <section>
      <h3 className="eyebrow mb-2">
        DST / offset changes in {zone} · {diff.transitionsTruncated ? `${diff.transitions.length}+` : diff.transitions.length}
      </h3>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border text-xs">
        {shown.map((t) => {
          const day = diff.irregularDays.find((d) => d.date === t.wallAfter.slice(0, 10))
          return (
            <li key={t.epochMs} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="mono text-fg">{t.wallBefore.slice(0, 10)}</span>
              <span className="mono text-muted">
                {t.wallBefore.slice(11)} → {t.wallAfter.slice(11)}
              </span>
              <span className="text-muted">
                {t.abbrBefore} → {t.abbrAfter}
              </span>
              <Badge tone={t.deltaMinutes > 0 ? 'mod' : 'accent'}>{t.deltaMinutes > 0 ? `clocks +${t.deltaMinutes / 60} h` : `clocks −${-t.deltaMinutes / 60} h`}</Badge>
              {day && <span className="ml-auto text-warn">that day is {day.hours} hours long</span>}
            </li>
          )
        })}
      </ul>
      {more > 0 && <p className="mt-1 text-2xs text-subtle">…and {diff.transitionsTruncated ? 'more than ' : ''}{more} more.</p>}
    </section>
  )
}
