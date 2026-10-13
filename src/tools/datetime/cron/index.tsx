import { useMemo, useState } from 'react'
import { CalendarClock, ChevronDown, Info, ListChecks, TriangleAlert } from 'lucide-react'
import { CRON_PRESETS, DIALECTS, FIELD_LABELS, describeValues, fieldSpec, parseCron, splitExpression, type CronDialect, type CronFieldName, type DayRule, type FieldResult } from '@/engines/datetime/cron'
import { describeCron } from '@/engines/datetime/cron-describe'
import { nextRuns, type CronRun, type DstPolicy } from '@/engines/datetime/cron-schedule'
import { formatRelative } from '@/engines/datetime/format'
import { localTimeZone } from '@/engines/datetime/zones'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { Toolbar, ToolbarField, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { EmptyState } from '@/components/tools/EmptyState'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CopyButton } from '@/components/common/CopyButton'
import { ZonePicker } from '../_shared/ZonePicker'
import { useNow } from '../_shared/useNow'
import { FieldEditor } from './FieldEditor'
import { cn } from '@/utils/cn'

const DEFAULT_EXPRS: Record<CronDialect, string> = {
  unix: '*/15 9-17 * * 1-5',
  seconds: '0 */5 9-17 * * 1-5',
  quartz: '0 0 9 ? * MON-FRI',
  aws: 'cron(0 9 ? * MON-FRI *)',
}

const POLICY_TEXT: Record<DstPolicy, string> = {
  vixie: 'DST (Vixie/cronie): a fixed-time job whose time is skipped runs right after the clocks jump; in a repeated hour it runs once. Jobs with * in minute or hour just follow the clock.',
  instant: 'DST (per-second matcher, node-cron style): a skipped wall time never runs; a repeated wall time runs twice.',
  wall: 'DST (Quartz): a skipped time moves forward by the gap (02:30 → 03:30); a repeated time fires once, and the repeated hour isn’t revisited.',
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function CronTool() {
  const localZone = useMemo(() => localTimeZone(), [])
  const [dialect, setDialect] = usePersistentState<CronDialect>('dialect', 'unix')
  const [exprs, setExprs] = usePersistentState<Record<CronDialect, string>>('expressions', DEFAULT_EXPRS)
  const [zone, setZone] = usePersistentState('zone', localZone)
  const [count, setCount] = usePersistentState<'10' | '25' | '50'>('count', '10')
  const [dayRule, setDayRule] = usePersistentState<DayRule>('dayRule', 'or')
  const [editing, setEditing] = useState<number | null>(null)
  const now = useNow(false, 15_000)
  const expr = exprs[dialect] ?? DEFAULT_EXPRS[dialect]
  const setExpr = (v: string) => setExprs({ ...exprs, [dialect]: v })

  useIncomingInput((t) => setExpr(t.trim()))

  const parsed = useMemo(() => parseCron(expr, dialect, { dayRule }), [expr, dialect, dayRule])
  const description = useMemo(() => (parsed.ok ? describeCron(parsed.cron) : null), [parsed])
  // Recompute runs when the minute changes (or inputs change), not every render.
  const minute = Math.floor(now / 60_000)
  const schedule = useMemo(
    () => (parsed.ok ? nextRuns(parsed.cron, { fromMs: Date.now(), zone, count: Number(count) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsed, zone, count, minute],
  )

  const tokens = splitExpression(expr, dialect).tokens
  const info = DIALECTS[dialect]
  const chipFields: { name: CronFieldName; raw: string; implicit: boolean; result?: FieldResult }[] = useMemo(() => {
    if (parsed.ok || parsed.fields.length) {
      return parsed.fields.map((f) => ({ name: f.name, raw: f.raw, implicit: !!f.implicit, result: f }))
    }
    return []
  }, [parsed])

  const applyField = (index: number, token: string) => {
    const t = [...tokens]
    while (t.length <= index) t.push('*')
    t[index] = token
    const body = t.join(' ')
    const wrapped = dialect === 'aws' && /^\s*cron\s*\(/i.test(expr) ? `cron(${body})` : body
    setExpr(wrapped)
    setEditing(null)
  }

  const presets = CRON_PRESETS.filter((p) => p.expr[dialect])
  const errors = parsed.ok ? [] : parsed.errors
  const warnings = parsed.warnings

  return (
    <>
      <Toolbar>
        <ToolbarField label="Dialect">
          <Select
            aria-label="Cron dialect"
            value={dialect}
            onValueChange={(d) => {
              setDialect(d)
              setEditing(null)
            }}
            options={(Object.keys(DIALECTS) as CronDialect[]).map((d) => ({ value: d, label: DIALECTS[d].name, description: DIALECTS[d].description }))}
          />
        </ToolbarField>
        {dialect === 'seconds' && (
          <ToolbarField label="Day rule">
            <Select
              aria-label="Day-of-month / day-of-week rule"
              value={dayRule}
              onValueChange={setDayRule}
              options={[
                { value: 'or', label: 'OR (cron-parser, croner)', description: 'Both day fields restricted → either may match (Vixie rule)' },
                { value: 'and', label: 'AND (node-cron)', description: 'Day-of-month and day-of-week must both match' },
              ]}
            />
          </ToolbarField>
        )}
        <ToolbarField label="Zone">
          <ZonePicker aria-label="Time zone for run times" value={zone} onChange={setZone} atMs={now} />
        </ToolbarField>
        <ToolbarField label="Runs">
          <Segmented
            aria-label="Number of runs"
            value={count}
            onValueChange={setCount}
            options={[
              { value: '10', label: '10' },
              { value: '25', label: '25' },
              { value: '50', label: '50' },
            ]}
          />
        </ToolbarField>
        <ToolbarSpacer />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              <ListChecks /> Presets <ChevronDown className="text-subtle" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-[60vh] w-72 overflow-y-auto">
            {presets.map((p) => (
              <DropdownMenuItem key={p.label} onSelect={() => setExpr(p.expr[dialect]!)} className="justify-between gap-3">
                <span className="truncate">{p.label}</span>
                <span className="mono shrink-0 text-2xs text-subtle">{p.expr[dialect]}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </Toolbar>

      <div className="shrink-0 border-b border-border bg-bg px-3 pb-3 pt-3 md:px-4">
        <div className="flex items-center gap-2">
          <Input
            aria-label="Cron expression"
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            spellCheck={false}
            placeholder={info.example}
            aria-invalid={!parsed.ok}
            className="mono h-10 flex-1 text-[16px] tracking-wide"
          />
          <CopyButton value={expr} label="Copy expression" />
        </div>
        <div className="mt-2 flex flex-wrap items-stretch gap-1.5" aria-label="Fields">
          {chipFields.length ? (
            chipFields.map((f, i) => {
              const err = f.result?.error
              const warn = f.result?.warnings.length
              return (
                <Popover key={`${dialect}-${f.name}`} open={editing === i} onOpenChange={(o) => setEditing(o ? i : null)}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Edit ${FIELD_LABELS[f.name]}: ${f.raw}`}
                      className={cn(
                        'flex min-w-[64px] flex-col items-start rounded-md border px-2 py-1 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                        err ? 'border-danger/50 bg-danger-soft' : warn ? 'border-warn/40 bg-warn-soft' : 'border-border bg-surface hover:border-border-strong',
                        editing === i && 'border-accent',
                        f.implicit && 'border-dashed opacity-70',
                      )}
                    >
                      <span className={cn('text-[10px] uppercase tracking-wider', err ? 'text-danger' : 'text-subtle')}>{FIELD_LABELS[f.name]}</span>
                      <span className="mono text-[13px] text-fg">{f.raw}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start">
                    <FieldEditor key={`${f.raw}`} dialect={dialect} name={f.name} raw={f.implicit ? '*' : f.raw} onApply={(t) => applyField(i, t)} />
                  </PopoverContent>
                </Popover>
              )
            })
          ) : (
            <span className="text-2xs text-subtle">
              Fields: {info.fields.map((f) => FIELD_LABELS[f]).join(' · ')}
              {info.optionalYear ? ' (year optional)' : ''}
            </span>
          )}
          {chipFields.length > 0 && <span className="self-center pl-1 text-2xs text-subtle">Click a field to edit it</span>}
        </div>
      </div>

      {errors.length > 0 && (
        <div role="alert" className="shrink-0 border-b border-danger/25 bg-danger-soft px-3 py-2 text-sm md:px-4">
          {errors.map((e, i) => (
            <p key={i} className="flex gap-2">
              <span className="w-28 shrink-0 text-xs font-medium text-danger">{e.field ? FIELD_LABELS[e.field] : 'Expression'}</span>
              <span className="min-w-0">{e.message}</span>
            </p>
          ))}
        </div>
      )}
      {parsed.ok && description && (
        <div className="shrink-0 border-b border-border bg-workspace px-3 py-3 md:px-4">
          <p className="text-base font-medium leading-6 text-fg">{description.text}</p>
          {[...description.notes, ...warnings.map((w) => `${w.field ? FIELD_LABELS[w.field] + ': ' : ''}${w.message}`)].map((n) => (
            <p key={n} className="mt-1 flex gap-1.5 text-xs text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0 text-subtle" />
              {n}
            </p>
          ))}
          {dialect === 'aws' && zone !== 'UTC' && (
            <p className="mt-1 flex gap-1.5 text-xs text-warn">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              Times below are in {zone}, as with EventBridge Scheduler’s time-zone setting. EventBridge rules always use UTC.
            </p>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-workspace lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden">
        <Pane className="flex-none lg:min-h-0 lg:border-r lg:border-border">
          <PaneHeader title="Fields" meta={info.name} />
          <div className="overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-2xs font-medium uppercase tracking-wider text-subtle">
                  <th className="px-3 py-1.5 font-medium">Field</th>
                  <th className="px-3 py-1.5 font-medium">Value</th>
                  <th className="px-3 py-1.5 font-medium">Meaning</th>
                  <th className="px-3 py-1.5 font-medium">Allowed</th>
                </tr>
              </thead>
              <tbody>
                {info.fields.map((name, i) => {
                  const spec = fieldSpec(dialect, name)
                  const fr = chipFields.find((f) => f.name === name)?.result
                  const field = parsed.ok ? parsed.cron.fields[name] : fr?.field
                  return (
                    <tr key={name} className="group border-b border-border align-top hover:bg-surface-2/40">
                      <td className="px-3 py-2 text-xs text-muted">
                        {spec.label}
                        {name === 'year' && info.optionalYear && <span className="block text-2xs text-subtle">optional</span>}
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" disabled={!chipFields.length} onClick={() => setEditing(i)} className="mono rounded-sm text-[13px] text-accent-text hover:underline disabled:text-fg disabled:no-underline">
                          {fr?.raw ?? tokens[i] ?? '—'}
                        </button>
                      </td>
                      <td className={cn('px-3 py-2 text-xs', fr?.error ? 'text-danger' : 'text-fg/90')}>{fr?.error ?? (field ? describeValues(field, dialect) : '—')}</td>
                      <td className="px-3 py-2 text-2xs text-muted">
                        <span className="mono">{spec.allowedText}</span>
                        <span className="mono block text-subtle">{spec.specials.join(' ')}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="px-3 py-3 text-2xs leading-4 text-subtle">
              {dialect === 'unix' && 'Vixie/cronie: day-of-week 0 and 7 are Sunday; macros @hourly, @daily, @weekly, @monthly, @yearly, @reboot. No seconds, ?, L, W or #.'}
              {dialect === 'seconds' && 'Same value syntax as Unix cron with a leading seconds field. ?, L, W and # are not accepted here — use the Quartz dialect for those.'}
              {dialect === 'quartz' && 'Quartz: day-of-week 1–7 = SUN–SAT. Exactly one of day-of-month / day-of-week must be ?. Ranges may wrap (FRI-MON, 22-2). Year 1970–2099 is optional.'}
              {dialect === 'aws' && 'EventBridge: like Quartz without seconds; the year field is required; L-n isn’t supported; minimum interval is 1 minute. Accepts the cron(...) wrapper.'}
            </p>
          </div>
        </Pane>
        <Pane className="flex-none border-t border-border lg:min-h-0 lg:border-t-0">
          <PaneHeader
            title={`Next ${count} runs`}
            meta={zone}
            actions={schedule && schedule.runs.length > 0 && <CopyButton value={() => schedule.runs.map((r) => `${r.wall} ${r.offset}`).join('\n')} label="Copy run times" />}
          />
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {!parsed.ok ? (
              <EmptyState compact icon={<CalendarClock />} title="Fix the expression to see run times" description="Errors are listed above, per field." />
            ) : parsed.cron.reboot ? (
              <EmptyState compact icon={<CalendarClock />} title="@reboot runs once at startup" description="It has no calendar schedule, so there are no run times to list." />
            ) : schedule && schedule.runs.length === 0 ? (
              <EmptyState compact icon={<TriangleAlert />} title="This schedule never fires" description={`No matching date before ${schedule.horizonYear} — e.g. February 30th, or a 5th Monday in a month that has none.`} />
            ) : (
              schedule && (
                <>
                  <ol className="divide-y divide-border">
                    {schedule.runs.map((r, i) => (
                      <RunRow key={String(r.epochNs)} run={r} index={i} now={now} prev={schedule.runs[i - 1]} />
                    ))}
                  </ol>
                  {schedule.exhausted && <p className="px-3 py-2 text-xs text-warn">Only {schedule.runs.length} run{schedule.runs.length === 1 ? '' : 's'} before {schedule.horizonYear}.</p>}
                  {schedule.skipped.length > 0 && (
                    <div className="border-t border-border px-3 py-2">
                      <p className="eyebrow mb-1">Skipped by DST</p>
                      {schedule.skipped.map((s) => (
                        <p key={s.wall} className="text-xs text-warn">
                          <span className="mono">{s.wall}</span> — {s.text}
                        </p>
                      ))}
                    </div>
                  )}
                  <p className="border-t border-border px-3 py-2 text-2xs leading-4 text-subtle">{POLICY_TEXT[schedule.policy]}</p>
                </>
              )
            )}
          </div>
        </Pane>
      </div>
      <StatusBar>
        <StatusItem label="Dialect">{info.short}</StatusItem>
        <StatusItem label="Fields">{tokens.length || (parsed.ok && parsed.cron.macro) || 0}</StatusItem>
        {parsed.ok ? <StatusItem tone="ok">Valid</StatusItem> : <StatusItem tone="danger">{errors.length} error{errors.length === 1 ? '' : 's'}</StatusItem>}
        {schedule?.runs.some((r) => r.note) && <StatusItem tone="mod">DST affects listed runs</StatusItem>}
        <StatusSpacer />
        <StatusItem label="Zone">{zone}</StatusItem>
        <Badge tone="neutral">Processed locally</Badge>
      </StatusBar>
    </>
  )
}

function RunRow({ run, index, now, prev }: { run: CronRun; index: number; now: number; prev?: CronRun }) {
  const newDay = !prev || prev.wall.slice(0, 10) !== run.wall.slice(0, 10)
  const abbr = /^GMT[+-]/.test(run.abbreviation) ? '' : run.abbreviation
  return (
    <li className={cn('group px-3 py-1.5', run.note && 'bg-warn-soft/50')}>
      <div className="flex items-center gap-3">
        <span className="w-6 shrink-0 text-right text-2xs text-subtle tabular">{index + 1}</span>
        <span className={cn('mono text-[13px] tabular', newDay ? 'text-fg' : 'text-muted')}>
          <span className={cn(!newDay && 'opacity-40')}>{run.wall.slice(0, 10)}</span> <span className="text-fg">{run.wall.slice(11)}</span>
        </span>
        <span className="w-8 text-2xs text-muted">{WD[run.dayOfWeek - 1]}</span>
        <span className="mono hidden text-2xs text-subtle sm:inline">
          {run.offset}
          {abbr && ` ${abbr}`}
        </span>
        <span className="ml-auto truncate text-2xs text-muted">{formatRelative(run.epochMs, now)}</span>
        <CopyButton value={new Date(run.epochMs).toISOString()} label="Copy as ISO 8601 UTC" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
      </div>
      {run.note && (
        <p className="ml-9 mt-0.5 flex gap-1.5 text-2xs text-warn">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          {run.note.text}
        </p>
      )}
    </li>
  )
}
