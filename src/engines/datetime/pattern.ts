import { Temporal } from 'temporal-polyfill'
import { isoYear } from './format'
import { zoneAbbreviation, zoneLongName } from './zones'

/**
 * Two custom-pattern syntaxes over a ZonedDateTime:
 *  - token patterns (moment/day.js style): `YYYY-MM-DD HH:mm:ss`, `[escaped text]`
 *  - strftime (C / Python / GNU date): `%Y-%m-%d %H:%M:%S`, flags `%-d`, `%_d`, `%^a`
 * Names (months, weekdays, AM/PM) come from Intl for the chosen locale.
 */

export interface TokenDoc {
  token: string
  description: string
  /** Output for the reference instant 2024-03-05T09:07:03.045 (Tue) in the docs. */
  example: string
  group: 'Year' | 'Quarter' | 'Month' | 'Week' | 'Day' | 'Time' | 'Zone' | 'Unix' | 'Other'
}

export interface PatternResult {
  output: string
  /** Unknown directives or tokens that were emitted literally. */
  warnings: string[]
}

const pad = (n: number, w = 2) => (n < 0 ? '-' : '') + String(Math.abs(n)).padStart(w, '0')

export function ordinalEn(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')
}

const nameCache = new Map<string, string>()
function intlName(locale: string, kind: 'month-long' | 'month-short' | 'weekday-long' | 'weekday-short', index: number): string {
  const key = `${locale}|${kind}|${index}`
  const hit = nameCache.get(key)
  if (hit) return hit
  // 2024-01-01 is a Monday; index is 1-based month or ISO weekday (1 = Monday).
  const d = kind.startsWith('month') ? Date.UTC(2024, index - 1, 15, 12) : Date.UTC(2024, 0, index, 12)
  const opts: Intl.DateTimeFormatOptions =
    kind === 'month-long' ? { month: 'long' } : kind === 'month-short' ? { month: 'short' } : kind === 'weekday-long' ? { weekday: 'long' } : { weekday: 'short' }
  let out: string
  try {
    out = new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(d)
  } catch {
    out = new Intl.DateTimeFormat('en', { ...opts, timeZone: 'UTC' }).format(d)
  }
  nameCache.set(key, out)
  return out
}

function dayPeriod(locale: string, hour: number): string {
  const key = `${locale}|period|${hour < 12 ? 'am' : 'pm'}`
  const hit = nameCache.get(key)
  if (hit) return hit
  let out = hour < 12 ? 'AM' : 'PM'
  try {
    const parts = new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true, timeZone: 'UTC' }).formatToParts(Date.UTC(2024, 0, 1, hour < 12 ? 9 : 15))
    out = parts.find((p) => p.type === 'dayPeriod')?.value ?? out
  } catch {
    /* keep English */
  }
  nameCache.set(key, out)
  return out
}

function hour12(h: number) {
  return h % 12 === 0 ? 12 : h % 12
}

function unixSeconds(z: Temporal.ZonedDateTime): string {
  const ns = z.epochNanoseconds
  const q = ns / 1_000_000_000n
  return (ns < 0n && ns % 1_000_000_000n !== 0n ? q - 1n : q).toString()
}
function unixMillis(z: Temporal.ZonedDateTime): string {
  const ns = z.epochNanoseconds
  const q = ns / 1_000_000n
  return (ns < 0n && ns % 1_000_000n !== 0n ? q - 1n : q).toString()
}

function subsecond(z: Temporal.ZonedDateTime): string {
  return pad(z.millisecond, 3) + pad(z.microsecond, 3) + pad(z.nanosecond, 3)
}

// ── Token patterns ─────────────────────────────────────────────────────────

type TokenFn = (z: Temporal.ZonedDateTime, locale: string) => string

const TOKENS: Record<string, TokenFn> = {
  YYYY: (z) => (z.year >= 0 && z.year <= 9999 ? pad(z.year, 4) : isoYear(z.year)),
  YY: (z) => pad(((z.year % 100) + 100) % 100),
  Q: (z) => String(Math.ceil(z.month / 3)),
  MMMM: (z, l) => intlName(l, 'month-long', z.month),
  MMM: (z, l) => intlName(l, 'month-short', z.month),
  MM: (z) => pad(z.month),
  Mo: (z) => ordinalEn(z.month),
  M: (z) => String(z.month),
  DDDD: (z) => pad(z.dayOfYear, 3),
  DDD: (z) => String(z.dayOfYear),
  DD: (z) => pad(z.day),
  Do: (z) => ordinalEn(z.day),
  D: (z) => String(z.day),
  dddd: (z, l) => intlName(l, 'weekday-long', z.dayOfWeek),
  ddd: (z, l) => intlName(l, 'weekday-short', z.dayOfWeek),
  d: (z) => String(z.dayOfWeek % 7),
  E: (z) => String(z.dayOfWeek),
  GGGG: (z) => pad(z.yearOfWeek ?? z.year, 4),
  WW: (z) => pad(z.weekOfYear ?? 0),
  Wo: (z) => ordinalEn(z.weekOfYear ?? 0),
  W: (z) => String(z.weekOfYear ?? 0),
  HH: (z) => pad(z.hour),
  H: (z) => String(z.hour),
  hh: (z) => pad(hour12(z.hour)),
  h: (z) => String(hour12(z.hour)),
  mm: (z) => pad(z.minute),
  m: (z) => String(z.minute),
  ss: (z) => pad(z.second),
  s: (z) => String(z.second),
  SSSSSSSSS: (z) => subsecond(z),
  SSSSSS: (z) => subsecond(z).slice(0, 6),
  SSS: (z) => subsecond(z).slice(0, 3),
  SS: (z) => subsecond(z).slice(0, 2),
  S: (z) => subsecond(z).slice(0, 1),
  A: (z, l) => dayPeriod(l, z.hour).toUpperCase(),
  a: (z, l) => dayPeriod(l, z.hour).toLowerCase(),
  ZZ: (z) => z.offset.replace(':', '').slice(0, 5),
  Z: (z) => z.offset.slice(0, 6),
  zzzz: (z) => zoneLongName(z.epochMilliseconds, z.timeZoneId),
  z: (z) => zoneAbbreviation(z.epochMilliseconds, z.timeZoneId),
  VV: (z) => z.timeZoneId,
  X: (z) => unixSeconds(z),
  x: (z) => unixMillis(z),
}

const TOKEN_KEYS = Object.keys(TOKENS).sort((a, b) => b.length - a.length)
const TOKEN_RE = new RegExp(`\\[([^\\]]*)\\]|${TOKEN_KEYS.join('|')}`, 'g')

export const TOKEN_DOCS: TokenDoc[] = [
  { token: 'YYYY', description: '4-digit year', example: '2024', group: 'Year' },
  { token: 'YY', description: '2-digit year', example: '24', group: 'Year' },
  { token: 'Q', description: 'Quarter (1–4)', example: '1', group: 'Quarter' },
  { token: 'MMMM', description: 'Month name', example: 'March', group: 'Month' },
  { token: 'MMM', description: 'Short month name', example: 'Mar', group: 'Month' },
  { token: 'MM', description: 'Month, 2 digits', example: '03', group: 'Month' },
  { token: 'M', description: 'Month (1–12)', example: '3', group: 'Month' },
  { token: 'Mo', description: 'Month ordinal (English)', example: '3rd', group: 'Month' },
  { token: 'W', description: 'ISO week (1–53)', example: '10', group: 'Week' },
  { token: 'WW', description: 'ISO week, 2 digits', example: '10', group: 'Week' },
  { token: 'Wo', description: 'ISO week ordinal', example: '10th', group: 'Week' },
  { token: 'GGGG', description: 'ISO week-numbering year', example: '2024', group: 'Week' },
  { token: 'DD', description: 'Day of month, 2 digits', example: '05', group: 'Day' },
  { token: 'D', description: 'Day of month', example: '5', group: 'Day' },
  { token: 'Do', description: 'Day ordinal (English)', example: '5th', group: 'Day' },
  { token: 'DDD', description: 'Day of year', example: '65', group: 'Day' },
  { token: 'DDDD', description: 'Day of year, 3 digits', example: '065', group: 'Day' },
  { token: 'dddd', description: 'Weekday name', example: 'Tuesday', group: 'Day' },
  { token: 'ddd', description: 'Short weekday name', example: 'Tue', group: 'Day' },
  { token: 'd', description: 'Weekday (0 = Sunday)', example: '2', group: 'Day' },
  { token: 'E', description: 'ISO weekday (1 = Monday)', example: '2', group: 'Day' },
  { token: 'HH', description: 'Hour 00–23', example: '09', group: 'Time' },
  { token: 'H', description: 'Hour 0–23', example: '9', group: 'Time' },
  { token: 'hh', description: 'Hour 01–12', example: '09', group: 'Time' },
  { token: 'h', description: 'Hour 1–12', example: '9', group: 'Time' },
  { token: 'mm', description: 'Minute, 2 digits', example: '07', group: 'Time' },
  { token: 'm', description: 'Minute', example: '7', group: 'Time' },
  { token: 'ss', description: 'Second, 2 digits', example: '03', group: 'Time' },
  { token: 's', description: 'Second', example: '3', group: 'Time' },
  { token: 'SSS', description: 'Milliseconds', example: '045', group: 'Time' },
  { token: 'SSSSSS', description: 'Microseconds', example: '045000', group: 'Time' },
  { token: 'SSSSSSSSS', description: 'Nanoseconds', example: '045000000', group: 'Time' },
  { token: 'A', description: 'AM / PM (locale)', example: 'AM', group: 'Time' },
  { token: 'a', description: 'am / pm (locale)', example: 'am', group: 'Time' },
  { token: 'Z', description: 'Offset ±HH:mm', example: '+05:30', group: 'Zone' },
  { token: 'ZZ', description: 'Offset ±HHmm', example: '+0530', group: 'Zone' },
  { token: 'z', description: 'Zone abbreviation', example: 'IST', group: 'Zone' },
  { token: 'zzzz', description: 'Zone long name', example: 'India Standard Time', group: 'Zone' },
  { token: 'VV', description: 'IANA zone id', example: 'Asia/Kolkata', group: 'Zone' },
  { token: 'X', description: 'Unix seconds', example: '1709609823', group: 'Unix' },
  { token: 'x', description: 'Unix milliseconds', example: '1709609823045', group: 'Unix' },
  { token: '[text]', description: 'Literal text (escaped)', example: 'text', group: 'Other' },
]

/** Formats with a token pattern. Letters that aren't tokens are kept literally (like moment). */
export function formatTokens(z: Temporal.ZonedDateTime, pattern: string, locale = 'en-US'): PatternResult {
  const warnings: string[] = []
  if (/\[[^\]]*$/.test(pattern.replace(/\[[^\]]*\]/g, ''))) warnings.push('Unclosed “[” — the rest of the pattern is formatted, not escaped.')
  const output = pattern.replace(TOKEN_RE, (match, escaped: string | undefined) => {
    if (escaped !== undefined) return escaped
    return TOKENS[match](z, locale)
  })
  return { output, warnings }
}

/** Splits a token pattern for syntax highlighting. */
export function tokenizePattern(pattern: string): { text: string; kind: 'token' | 'escape' | 'literal' }[] {
  const out: { text: string; kind: 'token' | 'escape' | 'literal' }[] = []
  let last = 0
  for (const m of pattern.matchAll(TOKEN_RE)) {
    if (m.index! > last) out.push({ text: pattern.slice(last, m.index), kind: 'literal' })
    out.push({ text: m[0], kind: m[1] !== undefined ? 'escape' : 'token' })
    last = m.index! + m[0].length
  }
  if (last < pattern.length) out.push({ text: pattern.slice(last), kind: 'literal' })
  return out
}

// ── strftime ───────────────────────────────────────────────────────────────

type Pad = '0' | ' ' | ''
type Directive = (z: Temporal.ZonedDateTime, locale: string) => { value: string | number; width?: number; pad?: Pad }

function weekOfYear(z: Temporal.ZonedDateTime, firstDay: 0 | 1): number {
  // %U: weeks start Sunday; %W: weeks start Monday. Days before the first such day are week 0.
  const yday = z.dayOfYear - 1
  const wday = z.dayOfWeek % 7 // 0 = Sunday
  const offset = firstDay === 0 ? wday : (wday + 6) % 7
  return Math.floor((yday + 7 - offset) / 7)
}

const localeDateFmt = new Map<string, Intl.DateTimeFormat>()
function intlStyle(z: Temporal.ZonedDateTime, locale: string, opts: Intl.DateTimeFormatOptions): string {
  const key = `${locale}|${z.timeZoneId}|${JSON.stringify(opts)}`
  let f = localeDateFmt.get(key)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: z.timeZoneId })
    } catch {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: z.timeZoneId })
    }
    localeDateFmt.set(key, f)
  }
  return f.format(z.epochMilliseconds)
}

const DIRECTIVES: Record<string, Directive> = {
  Y: (z) => ({ value: z.year, width: 4 }),
  C: (z) => ({ value: Math.floor(z.year / 100), width: 2 }),
  y: (z) => ({ value: ((z.year % 100) + 100) % 100, width: 2 }),
  G: (z) => ({ value: z.yearOfWeek ?? z.year, width: 4 }),
  g: (z) => ({ value: (((z.yearOfWeek ?? z.year) % 100) + 100) % 100, width: 2 }),
  m: (z) => ({ value: z.month, width: 2 }),
  B: (z, l) => ({ value: intlName(l, 'month-long', z.month) }),
  b: (z, l) => ({ value: intlName(l, 'month-short', z.month) }),
  h: (z, l) => ({ value: intlName(l, 'month-short', z.month) }),
  d: (z) => ({ value: z.day, width: 2 }),
  e: (z) => ({ value: z.day, width: 2, pad: ' ' }),
  j: (z) => ({ value: z.dayOfYear, width: 3 }),
  A: (z, l) => ({ value: intlName(l, 'weekday-long', z.dayOfWeek) }),
  a: (z, l) => ({ value: intlName(l, 'weekday-short', z.dayOfWeek) }),
  u: (z) => ({ value: z.dayOfWeek }),
  w: (z) => ({ value: z.dayOfWeek % 7 }),
  U: (z) => ({ value: weekOfYear(z, 0), width: 2 }),
  W: (z) => ({ value: weekOfYear(z, 1), width: 2 }),
  V: (z) => ({ value: z.weekOfYear ?? 0, width: 2 }),
  H: (z) => ({ value: z.hour, width: 2 }),
  k: (z) => ({ value: z.hour, width: 2, pad: ' ' }),
  I: (z) => ({ value: hour12(z.hour), width: 2 }),
  l: (z) => ({ value: hour12(z.hour), width: 2, pad: ' ' }),
  M: (z) => ({ value: z.minute, width: 2 }),
  S: (z) => ({ value: z.second, width: 2 }),
  L: (z) => ({ value: subsecond(z).slice(0, 3) }),
  f: (z) => ({ value: subsecond(z).slice(0, 6) }),
  N: (z) => ({ value: subsecond(z) }),
  p: (z, l) => ({ value: dayPeriod(l, z.hour).toUpperCase() }),
  P: (z, l) => ({ value: dayPeriod(l, z.hour).toLowerCase() }),
  z: (z) => ({ value: z.offset.replace(':', '').slice(0, 5) }),
  Z: (z) => ({ value: zoneAbbreviation(z.epochMilliseconds, z.timeZoneId) }),
  s: (z) => ({ value: unixSeconds(z) }),
  c: (z, l) => ({ value: intlStyle(z, l, { dateStyle: 'medium', timeStyle: 'medium' }) }),
  x: (z, l) => ({ value: intlStyle(z, l, { dateStyle: 'short' }) }),
  X: (z, l) => ({ value: intlStyle(z, l, { timeStyle: 'medium' }) }),
  n: () => ({ value: '\n' }),
  t: () => ({ value: '\t' }),
  '%': () => ({ value: '%' }),
}

/** Composite directives, expanded before formatting. */
const COMPOSITES: Record<string, string> = {
  F: '%Y-%m-%d',
  T: '%H:%M:%S',
  D: '%m/%d/%y',
  R: '%H:%M',
  r: '%I:%M:%S %p',
}

export const STRFTIME_DOCS: TokenDoc[] = [
  { token: '%Y', description: 'Year', example: '2024', group: 'Year' },
  { token: '%y', description: '2-digit year', example: '24', group: 'Year' },
  { token: '%C', description: 'Century', example: '20', group: 'Year' },
  { token: '%G', description: 'ISO week-numbering year', example: '2024', group: 'Week' },
  { token: '%g', description: 'ISO week year, 2 digits', example: '24', group: 'Week' },
  { token: '%V', description: 'ISO week (01–53)', example: '10', group: 'Week' },
  { token: '%U', description: 'Week of year, Sunday start (00–53)', example: '09', group: 'Week' },
  { token: '%W', description: 'Week of year, Monday start (00–53)', example: '10', group: 'Week' },
  { token: '%m', description: 'Month (01–12)', example: '03', group: 'Month' },
  { token: '%B', description: 'Month name', example: 'March', group: 'Month' },
  { token: '%b', description: 'Short month name (also %h)', example: 'Mar', group: 'Month' },
  { token: '%d', description: 'Day of month (01–31)', example: '05', group: 'Day' },
  { token: '%e', description: 'Day of month, space-padded', example: ' 5', group: 'Day' },
  { token: '%j', description: 'Day of year (001–366)', example: '065', group: 'Day' },
  { token: '%A', description: 'Weekday name', example: 'Tuesday', group: 'Day' },
  { token: '%a', description: 'Short weekday name', example: 'Tue', group: 'Day' },
  { token: '%u', description: 'Weekday (1 = Monday)', example: '2', group: 'Day' },
  { token: '%w', description: 'Weekday (0 = Sunday)', example: '2', group: 'Day' },
  { token: '%H', description: 'Hour (00–23)', example: '09', group: 'Time' },
  { token: '%I', description: 'Hour (01–12)', example: '09', group: 'Time' },
  { token: '%k', description: 'Hour (0–23), space-padded', example: ' 9', group: 'Time' },
  { token: '%l', description: 'Hour (1–12), space-padded', example: ' 9', group: 'Time' },
  { token: '%M', description: 'Minute', example: '07', group: 'Time' },
  { token: '%S', description: 'Second', example: '03', group: 'Time' },
  { token: '%L', description: 'Milliseconds (Ruby)', example: '045', group: 'Time' },
  { token: '%f', description: 'Microseconds (Python)', example: '045000', group: 'Time' },
  { token: '%N', description: 'Nanoseconds (GNU date)', example: '045000000', group: 'Time' },
  { token: '%p', description: 'AM / PM', example: 'AM', group: 'Time' },
  { token: '%P', description: 'am / pm', example: 'am', group: 'Time' },
  { token: '%z', description: 'Offset ±hhmm', example: '+0530', group: 'Zone' },
  { token: '%:z', description: 'Offset ±hh:mm (GNU)', example: '+05:30', group: 'Zone' },
  { token: '%Z', description: 'Zone abbreviation', example: 'IST', group: 'Zone' },
  { token: '%s', description: 'Unix seconds', example: '1709609823', group: 'Unix' },
  { token: '%F', description: '%Y-%m-%d', example: '2024-03-05', group: 'Other' },
  { token: '%T', description: '%H:%M:%S', example: '09:07:03', group: 'Other' },
  { token: '%D', description: '%m/%d/%y', example: '03/05/24', group: 'Other' },
  { token: '%R', description: '%H:%M', example: '09:07', group: 'Other' },
  { token: '%r', description: '%I:%M:%S %p', example: '09:07:03 AM', group: 'Other' },
  { token: '%c', description: 'Locale date and time', example: 'Mar 5, 2024, 9:07:03 AM', group: 'Other' },
  { token: '%x', description: 'Locale date', example: '3/5/24', group: 'Other' },
  { token: '%X', description: 'Locale time', example: '9:07:03 AM', group: 'Other' },
  { token: '%-d', description: 'Flag “-”: no padding (also _ space, 0 zero, ^ upper)', example: '5', group: 'Other' },
  { token: '%%', description: 'Literal %', example: '%', group: 'Other' },
]

const STRFTIME_RE = /%([-_0^#]?)(:?)([a-zA-Z%])/g

export function formatStrftime(z: Temporal.ZonedDateTime, pattern: string, locale = 'en-US'): PatternResult {
  const warnings: string[] = []
  const expanded = pattern.replace(/%([-_0^]?)([FTDRr])/g, (_, flag: string, c: string) => (flag ? COMPOSITES[c].replace(/%/g, `%${flag}`) : COMPOSITES[c]))
  const output = expanded.replace(STRFTIME_RE, (whole, flag: string, colon: string, c: string) => {
    if (colon) {
      if (c === 'z') return z.offset.slice(0, 6)
      warnings.push(`Unknown directive ${whole} — kept as text.`)
      return whole
    }
    const fn = DIRECTIVES[c]
    if (!fn) {
      warnings.push(`Unknown directive ${whole} — kept as text.`)
      return whole
    }
    const r = fn(z, locale)
    let v = String(r.value)
    if (typeof r.value === 'number' && r.width) {
      const padChar: Pad = flag === '-' ? '' : flag === '_' ? ' ' : flag === '0' ? '0' : (r.pad ?? '0')
      const neg = r.value < 0
      const digits = String(Math.abs(r.value))
      v = (neg ? '-' : '') + (padChar ? digits.padStart(r.width, padChar) : digits)
    } else if (flag === '-' && typeof r.value === 'string') {
      v = v.trimStart()
    }
    if (flag === '^') v = v.toUpperCase()
    return v
  })
  if (/%$/.test(pattern.replace(/%%/g, ''))) warnings.push('Trailing “%” has no directive.')
  return { output, warnings: [...new Set(warnings)] }
}

export function tokenizeStrftime(pattern: string): { text: string; kind: 'token' | 'literal' }[] {
  const out: { text: string; kind: 'token' | 'literal' }[] = []
  let last = 0
  for (const m of pattern.matchAll(STRFTIME_RE)) {
    if (m.index! > last) out.push({ text: pattern.slice(last, m.index), kind: 'literal' })
    out.push({ text: m[0], kind: 'token' })
    last = m.index! + m[0].length
  }
  if (last < pattern.length) out.push({ text: pattern.slice(last), kind: 'literal' })
  return out
}

export const PATTERN_PRESETS = {
  tokens: [
    'YYYY-MM-DD HH:mm:ss',
    'ddd, MMM D, YYYY h:mm A',
    'dddd, MMMM Do YYYY',
    'DD/MM/YYYY',
    'MM/DD/YYYY hh:mm A',
    'YYYY-MM-DD[T]HH:mm:ss.SSSZ',
    'GGGG-[W]WW-E',
    '[Q]Q YYYY',
    'HH:mm:ss z',
  ],
  strftime: ['%Y-%m-%d %H:%M:%S', '%a, %d %b %Y %H:%M:%S %z', '%A, %B %-d, %Y', '%d/%m/%Y', '%I:%M %p', '%Y-%m-%dT%H:%M:%S%:z', '%G-W%V-%u', '%c'],
}
