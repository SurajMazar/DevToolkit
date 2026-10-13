import { useState } from 'react'
import { analyzeFieldToken, buildFieldToken, fieldSpec, parseCron, DIALECTS, type CronDialect, type CronFieldName, type FieldMode, type FieldModel } from '@/engines/datetime/cron'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/utils/cn'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const SPECIAL_HELP: Record<string, string> = {
  '*': 'any value',
  ',': 'list: 1,15,30',
  '-': 'range: 9-17',
  '/': 'step: */5 or 0-30/10',
  '?': 'no specific value (one day field must be ?)',
  L: 'last (day of month / weekday of month)',
  'L-n': 'n days before the last day',
  LW: 'last weekday of the month',
  W: 'nearest weekday: 15W',
  '#': 'nth weekday: 6#3 = 3rd Friday',
}

/** Popover body for editing one cron field with simple controls. */
export function FieldEditor({ dialect, name, raw, onApply }: { dialect: CronDialect; name: CronFieldName; raw: string; onApply: (token: string) => void }) {
  const spec = fieldSpec(dialect, name)
  const [model, setModel] = useState<FieldModel>(() => analyzeFieldToken(raw, dialect, name))
  const quartzLike = dialect === 'quartz' || dialect === 'aws'
  const isDay = name === 'dayOfMonth' || name === 'dayOfWeek'
  const token = buildFieldToken(model, dialect, name)
  const check = validateToken(dialect, name, token)

  const modes: { value: FieldMode; label: string }[] = [
    { value: 'every', label: 'Every' },
    { value: 'step', label: 'Interval' },
    { value: 'range', label: 'Range' },
    { value: 'list', label: 'Specific' },
    ...(quartzLike && isDay ? [{ value: 'nospec' as FieldMode, label: '?' }] : []),
    ...(quartzLike && isDay ? [{ value: 'special' as FieldMode, label: 'Special' }] : []),
  ]

  const valueLabel = (v: number) => (name === 'month' ? MONTHS[v - 1] : name === 'dayOfWeek' ? DOWS[spec.toCanonical(v)] : String(v))
  const values: number[] = []
  if (name !== 'year') for (let v = spec.min; v <= (name === 'dayOfWeek' && !quartzLike ? 6 : spec.max); v++) values.push(v)
  const num = (v: string, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.trunc(n) : fallback
  }

  return (
    <div className="flex w-[min(340px,calc(100vw-32px))] flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-fg">{spec.label}</p>
        <p className="text-2xs text-subtle">
          Allowed {spec.allowedText} · {DIALECTS[dialect].short}
        </p>
      </div>
      <Segmented aria-label="Field mode" size="xs" value={model.mode} onValueChange={(mode) => setModel({ ...model, mode })} options={modes} className="flex-wrap" />

      {model.mode === 'step' && (
        <div className="flex items-center gap-2 text-xs text-muted">
          every
          <Input type="number" aria-label="Interval" min={1} value={model.interval} onChange={(e) => setModel({ ...model, interval: Math.max(1, num(e.target.value, 1)) })} className="mono h-7 w-16" />
          starting at
          <Input type="number" aria-label="Start" min={spec.min} max={spec.max} value={model.start} onChange={(e) => setModel({ ...model, start: num(e.target.value, spec.min) })} className="mono h-7 w-16" />
        </div>
      )}
      {model.mode === 'range' && (
        <div className="flex items-center gap-2 text-xs text-muted">
          from
          <Input type="number" aria-label="From" min={spec.min} max={spec.max} value={model.from} onChange={(e) => setModel({ ...model, from: num(e.target.value, spec.min) })} className="mono h-7 w-16" />
          to
          <Input type="number" aria-label="To" min={spec.min} max={spec.max} value={model.to} onChange={(e) => setModel({ ...model, to: num(e.target.value, spec.max) })} className="mono h-7 w-16" />
          {name === 'dayOfWeek' && <span className="text-subtle">{valueLabel(model.from)}–{valueLabel(model.to)}</span>}
          {name === 'month' && <span className="text-subtle">{valueLabel(model.from)}–{valueLabel(model.to)}</span>}
        </div>
      )}
      {model.mode === 'list' &&
        (name === 'year' ? (
          <Input
            aria-label="Years, comma separated"
            value={model.list.join(',')}
            onChange={(e) => setModel({ ...model, list: e.target.value.split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite) })}
            placeholder="2025,2026"
            className="mono h-7"
          />
        ) : (
          <div className={cn('grid gap-1', values.length > 31 ? 'grid-cols-10' : values.length > 12 ? 'grid-cols-8' : values.length === 12 ? 'grid-cols-6' : 'grid-cols-7')}>
            {values.map((v) => {
              const on = model.list.includes(v)
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setModel({ ...model, list: on ? model.list.filter((x) => x !== v) : [...model.list, v] })}
                  className={cn(
                    'mono h-6 rounded-sm border text-[11px] tabular transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                    on ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-surface text-muted hover:border-border-strong hover:text-fg',
                  )}
                >
                  {valueLabel(v)}
                </button>
              )
            })}
          </div>
        ))}
      {model.mode === 'special' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {(name === 'dayOfMonth' ? ['L', 'LW', '15W', ...(dialect === 'quartz' ? ['L-3'] : [])] : ['6L', '2#1', '6#3', 'L']).map((s) => (
              <Button key={s} size="xs" variant={model.special === s ? 'subtle' : 'ghost'} className="mono" onClick={() => setModel({ ...model, special: s })}>
                {s}
              </Button>
            ))}
          </div>
          <Input aria-label="Special value" value={model.special} onChange={(e) => setModel({ ...model, special: e.target.value })} className="mono h-7" placeholder={name === 'dayOfMonth' ? 'L, L-3, LW, 15W' : '6L, MON#2'} />
        </div>
      )}

      <div className="rounded-md border border-border bg-surface/60 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="mono text-sm text-fg">{token}</span>
          <Button size="xs" variant="primary" disabled={!!check} onClick={() => onApply(token)}>
            Apply
          </Button>
        </div>
        {check && <p className="mt-1 text-2xs text-danger">{check}</p>}
      </div>
      <ul className="grid grid-cols-1 gap-x-3 gap-y-0.5 text-2xs text-subtle">
        {spec.specials.map((s) => (
          <li key={s}>
            <span className="mono inline-block w-8 text-muted">{s}</span>
            {SPECIAL_HELP[s] ?? ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Validates a single field token by parsing a minimal expression around it. */
function validateToken(dialect: CronDialect, name: CronFieldName, token: string): string | null {
  const fields = DIALECTS[dialect].fields
  const filler: Record<CronFieldName, string> = { second: '0', minute: '0', hour: '0', dayOfMonth: '*', month: '*', dayOfWeek: '*', year: '*' }
  if (dialect === 'quartz' || dialect === 'aws') {
    filler.dayOfWeek = '?'
    if (name === 'dayOfWeek') filler.dayOfMonth = token === '?' ? '*' : '?'
    if (name === 'dayOfMonth' && token === '?') filler.dayOfWeek = '*'
  }
  const expr = fields.map((f) => (f === name ? token : filler[f])).join(' ')
  const r = parseCron(expr, dialect)
  if (r.ok) return null
  return r.errors.find((e) => e.field === name)?.message ?? null
}
