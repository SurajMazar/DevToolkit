import { useMemo, useRef, useState } from 'react'
import { Clock3, Radio } from 'lucide-react'
import { Temporal } from 'temporal-polyfill'
import { parseDateInput } from '@/engines/datetime/parse'
import { formatRelative, httpDate, intlPresets, isoUtc, isoWithOffset, resolvedLocale, rfc2822, rfc3339, rfc9557, sqlDateTime, unixSecondsFloor } from '@/engines/datetime/format'
import { formatStrftime, formatTokens, PATTERN_PRESETS, STRFTIME_DOCS, TOKEN_DOCS, tokenizePattern, tokenizeStrftime, type TokenDoc } from '@/engines/datetime/pattern'
import { localTimeZone } from '@/engines/datetime/zones'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useIncomingInput } from '@/hooks/useIncomingInput'
import { Toolbar, ToolbarField, ToolbarSpacer } from '@/components/tools/Toolbar'
import { StatusBar, StatusItem, StatusSpacer } from '@/components/tools/StatusBar'
import { Pane, PaneHeader } from '@/components/tools/Pane'
import { ErrorDisplay } from '@/components/tools/ErrorDisplay'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/common/CopyButton'
import { ZonePicker } from '../_shared/ZonePicker'
import { useNow } from '../_shared/useNow'
import { cn } from '@/utils/cn'

type Syntax = 'tokens' | 'strftime'

const LOCALES = [
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['en-IN', 'English (India)'],
  ['de-DE', 'Deutsch'],
  ['fr-FR', 'Français'],
  ['es-ES', 'Español'],
  ['it-IT', 'Italiano'],
  ['pt-BR', 'Português (BR)'],
  ['nl-NL', 'Nederlands'],
  ['sv-SE', 'Svenska'],
  ['pl-PL', 'Polski'],
  ['tr-TR', 'Türkçe'],
  ['ru-RU', 'Русский'],
  ['ar-EG', 'العربية'],
  ['hi-IN', 'हिन्दी'],
  ['ne-NP', 'नेपाली'],
  ['zh-CN', '中文 (简体)'],
  ['ja-JP', '日本語'],
  ['ko-KR', '한국어'],
] as const

export default function DateFormatter() {
  const localZone = useMemo(() => localTimeZone(), [])
  const browserLocale = useMemo(() => resolvedLocale(typeof navigator !== 'undefined' ? navigator.language : 'en-US'), [])
  const [input, setInput] = usePersistentState('input', '2024-03-05T09:07:03.045Z')
  const [live, setLive] = usePersistentState('live', false)
  const [zone, setZone] = usePersistentState('zone', localZone)
  const [locale, setLocale] = usePersistentState('locale', browserLocale)
  const [syntax, setSyntax] = usePersistentState<Syntax>('syntax', 'tokens')
  const [tokenPattern, setTokenPattern] = usePersistentState('tokenPattern', 'dddd, MMMM Do YYYY [at] h:mm A z')
  const [strfPattern, setStrfPattern] = usePersistentState('strfPattern', '%A, %B %-d %Y at %-I:%M %p %Z')
  const now = useNow()
  const patternRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState('')

  useIncomingInput((t) => {
    setLive(false)
    setInput(t.trim())
  })

  const parsed = useMemo(() => (live ? null : parseDateInput(input, { zone })), [live, input, zone])
  const epochNs: bigint | null = live ? BigInt(now) * 1_000_000n : parsed?.ok ? parsed.epochNs : null
  const z = useMemo(() => (epochNs !== null ? Temporal.Instant.fromEpochNanoseconds(epochNs).toZonedDateTimeISO(zone) : null), [epochNs, zone])

  const pattern = syntax === 'tokens' ? tokenPattern : strfPattern
  const setPattern = syntax === 'tokens' ? setTokenPattern : setStrfPattern
  const custom = useMemo(() => (z ? (syntax === 'tokens' ? formatTokens(z, pattern, locale) : formatStrftime(z, pattern, locale)) : null), [z, syntax, pattern, locale])
  const pieces = useMemo(() => (syntax === 'tokens' ? tokenizePattern(pattern) : tokenizeStrftime(pattern)), [syntax, pattern])

  const standard = useMemo(() => {
    if (epochNs === null) return []
    const ms = Number(epochNs / 1_000_000n)
    return [
      { key: 'ISO 8601', hint: zone, value: isoWithOffset(epochNs, zone) },
      { key: 'ISO 8601 (UTC)', value: isoUtc(epochNs) },
      { key: 'RFC 3339', hint: zone, value: rfc3339(epochNs, zone) },
      { key: 'RFC 9557', hint: 'Temporal / Java ZonedDateTime', value: rfc9557(epochNs, zone) },
      { key: 'RFC 2822', hint: 'email', value: rfc2822(epochNs, zone) },
      { key: 'RFC 7231 HTTP-date', hint: 'always GMT', value: httpDate(epochNs) },
      { key: 'Unix seconds', value: unixSecondsFloor(epochNs).toString() },
      { key: 'Unix milliseconds', value: (epochNs >= 0n ? epochNs / 1_000_000n : -((-epochNs + 999_999n) / 1_000_000n)).toString() },
      { key: 'SQL DATETIME', hint: `${zone}, no offset`, value: sqlDateTime(epochNs, zone) },
      { key: 'SQL DATETIME (UTC)', value: sqlDateTime(epochNs, 'UTC') },
      { key: 'Relative', hint: 'updates live', value: formatRelative(ms, now, locale) },
    ]
  }, [epochNs, zone, locale, now])
  const presets = useMemo(() => (epochNs !== null ? intlPresets(Number(epochNs / 1_000_000n), zone, locale) : []), [epochNs, zone, locale])

  const insert = (token: string) => {
    const el = patternRef.current
    const text = token === '[text]' ? '[text]' : token
    if (!el) {
      setPattern(pattern + text)
      return
    }
    const start = el.selectionStart ?? pattern.length
    const end = el.selectionEnd ?? pattern.length
    const next = pattern.slice(0, start) + text + pattern.slice(end)
    setPattern(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + text.length, start + text.length)
    })
  }

  const docs = syntax === 'tokens' ? TOKEN_DOCS : STRFTIME_DOCS
  const shownDocs = filter ? docs.filter((d) => (d.token + ' ' + d.description).toLowerCase().includes(filter.toLowerCase())) : docs

  return (
    <>
      <Toolbar>
        <ToolbarField label="Date">
          <Input
            aria-label="Date to format"
            value={live ? 'now (live)' : input}
            disabled={live}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ISO 8601, Unix, RFC 2822…"
            aria-invalid={!live && parsed?.ok === false}
            className="mono h-7 w-[min(320px,60vw)] text-[12.5px]"
          />
        </ToolbarField>
        <Button size="sm" variant={live ? 'subtle' : 'ghost'} aria-pressed={live} onClick={() => setLive(!live)} className={cn(live && 'text-accent-text')}>
          <Radio /> {live ? 'Live' : 'Live now'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setLive(false)
            setInput(Temporal.Now.instant().toString({ smallestUnit: 'millisecond' }))
          }}
        >
          <Clock3 /> Now
        </Button>
        <ToolbarField label="Zone">
          <ZonePicker aria-label="Time zone" value={zone} onChange={setZone} atMs={epochNs !== null ? Number(epochNs / 1_000_000n) : now} />
        </ToolbarField>
        <ToolbarField label="Locale">
          <Select
            aria-label="Locale"
            value={locale}
            onValueChange={setLocale}
            options={[...(LOCALES.some(([l]) => l === browserLocale) ? [] : [{ value: browserLocale, label: `${browserLocale} (browser)` }]), ...LOCALES.map(([value, label]) => ({ value, label: `${label}`, description: value }))]}
          />
        </ToolbarField>
        <ToolbarSpacer />
      </Toolbar>
      {!live && parsed && !parsed.ok && <ErrorDisplay error={parsed.message} />}
      {!live && parsed?.ok && (parsed.warnings.length > 0 || parsed.note) && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-bg px-3 py-1.5 text-xs text-muted md:px-4">
          <Badge tone={parsed.kind === 'browser' ? 'warn' : 'accent'}>{parsed.label}</Badge>
          {parsed.note && <span>{parsed.note}</span>}
          {parsed.warnings.map((w) => (
            <span key={w} className="text-warn">
              {w}
            </span>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-workspace lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:overflow-hidden">
        <Pane className="flex-none lg:min-h-0 lg:border-r lg:border-border">
          <PaneHeader title="Standard formats" meta={epochNs !== null ? zone : undefined} />
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {epochNs === null ? (
              <p className="p-4 text-sm text-muted">Enter a date to see it in every format.</p>
            ) : (
              <>
                <FormatList rows={standard} />
                <h3 className="eyebrow border-b border-border bg-surface/40 px-3 py-1.5">Intl presets · {resolvedLocale(locale)}</h3>
                <FormatList rows={presets.map((p) => ({ key: p.label, value: p.value, hint: optionsText(p.options) }))} mono={false} />
              </>
            )}
          </div>
        </Pane>
        <Pane className="flex-none border-t border-border lg:min-h-0 lg:border-t-0">
          <PaneHeader title="Custom pattern">
            <Segmented
              aria-label="Pattern syntax"
              size="xs"
              value={syntax}
              onValueChange={setSyntax}
              options={[
                { value: 'tokens', label: 'Tokens (YYYY-MM-DD)' },
                { value: 'strftime', label: 'strftime (%Y-%m-%d)' },
              ]}
            />
          </PaneHeader>
          <div className="flex flex-col gap-3 border-b border-border p-3 md:p-4">
            <Input
              ref={patternRef}
              aria-label="Pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={syntax === 'tokens' ? 'YYYY-MM-DD HH:mm:ss' : '%Y-%m-%d %H:%M:%S'}
              className="mono h-9 text-[13.5px]"
            />
            <div aria-hidden className="mono -mt-1 flex min-h-5 flex-wrap text-[12px] leading-5">
              {pieces.map((p, i) => (
                <span key={i} className={cn('whitespace-pre', p.kind === 'token' ? 'rounded-xs bg-accent-soft text-accent-text' : p.kind === 'escape' ? 'text-mod' : 'text-subtle')}>
                  {p.text}
                </span>
              ))}
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-surface/50 px-3 py-2.5">
              <p className="mono min-w-0 flex-1 whitespace-pre-wrap break-words text-base leading-6 text-fg">{custom ? custom.output || <span className="text-subtle">(empty)</span> : <span className="text-subtle">—</span>}</p>
              <CopyButton value={custom?.output ?? ''} label="Copy formatted output" disabled={!custom?.output} />
            </div>
            {custom?.warnings.map((w) => (
              <p key={w} className="text-xs text-warn">
                {w}
              </p>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {PATTERN_PRESETS[syntax].map((p) => (
                <button key={p} type="button" onClick={() => setPattern(p)} className={cn('mono rounded-sm border px-1.5 py-0.5 text-2xs transition-colors', p === pattern ? 'border-accent/50 bg-accent-soft text-accent-text' : 'border-border bg-surface text-muted hover:border-border-strong hover:text-fg')}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
            <h3 className="eyebrow">Reference</h3>
            <span className="text-2xs text-subtle">click to insert at the cursor{syntax === 'tokens' ? ' · letters that aren’t tokens print as-is; wrap text in [ ]' : ' · flags: %-d no pad, %_d space pad, %^a upper'}</span>
            <Input aria-label="Filter tokens" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="ml-auto h-6 w-28 text-xs" />
          </div>
          <TokenReference docs={shownDocs} z={z} syntax={syntax} locale={locale} onInsert={insert} />
        </Pane>
      </div>
      <StatusBar>
        <StatusItem label="Instant">{epochNs !== null ? isoUtc(epochNs) : '—'}</StatusItem>
        {live && <StatusItem tone="accent">Live</StatusItem>}
        <StatusSpacer />
        <StatusItem label="Zone">{zone}</StatusItem>
        <StatusItem label="Locale">{resolvedLocale(locale)}</StatusItem>
        <Badge tone="neutral">Processed locally</Badge>
      </StatusBar>
    </>
  )
}

function optionsText(o: Intl.DateTimeFormatOptions) {
  return Object.entries(o)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
}

function FormatList({ rows, mono = true }: { rows: { key: string; value: string; hint?: string }[]; mono?: boolean }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.key} className="group grid grid-cols-[minmax(120px,38%)_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5">
          <span className="min-w-0 text-xs text-muted">
            {r.key}
            {r.hint && <span className="block truncate text-2xs text-subtle">{r.hint}</span>}
          </span>
          <span className={cn('min-w-0 text-[12.5px] leading-5 text-fg', mono ? 'mono break-all' : 'break-words')}>{r.value}</span>
          <CopyButton value={r.value} label={`Copy ${r.key}`} size="icon-xs" className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100" />
        </li>
      ))}
    </ul>
  )
}

function TokenReference({ docs, z, syntax, locale, onInsert }: { docs: TokenDoc[]; z: Temporal.ZonedDateTime | null; syntax: Syntax; locale: string; onInsert: (t: string) => void }) {
  const live = (d: TokenDoc) => {
    if (!z) return d.example
    if (d.token === '[text]') return 'text'
    if (d.token === '%-d') return formatStrftime(z, '%-d', locale).output
    return syntax === 'tokens' ? formatTokens(z, d.token, locale).output : formatStrftime(z, d.token, locale).output
  }
  const groups = [...new Set(docs.map((d) => d.group))]
  return (
    <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      {groups.map((g) => (
        <div key={g}>
          <p className="eyebrow sticky top-0 z-10 border-b border-border bg-workspace px-3 pb-1 pt-2">{g}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {docs
              .filter((d) => d.group === g)
              .map((d) => (
                <button
                  key={d.token}
                  type="button"
                  onClick={() => onInsert(d.token)}
                  className="group grid grid-cols-[72px_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-border/60 px-3 py-1.5 text-left hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:odd:border-r"
                  title={`Insert ${d.token}`}
                >
                  <span className="mono text-[12.5px] text-accent-text">{d.token}</span>
                  <span className="truncate text-xs text-muted">{d.description}</span>
                  <span className="mono max-w-[140px] truncate whitespace-pre text-2xs text-fg/80">{live(d)}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
      {!docs.length && <p className="px-3 py-6 text-center text-sm text-muted">No token matches the filter.</p>}
    </div>
  )
}
