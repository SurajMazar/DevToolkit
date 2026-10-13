import { Temporal } from 'temporal-polyfill'
import { zoneAbbreviation, zoneLongName } from './zones'

/** Standard machine formats and relative time for an exact instant. Pure; zones are explicit. */

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function toZoned(epochNs: bigint, zone: string): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochNanoseconds(epochNs).toZonedDateTimeISO(zone)
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0')

/** Year as ISO 8601 writes it: 4 digits, or ±6 digits outside 0000–9999. */
export function isoYear(y: number): string {
  if (y >= 0 && y <= 9999) return pad(y, 4)
  return (y < 0 ? '-' : '+') + pad(y, 6)
}

/** Sub-second digits: '' when zero, else 3/6/9 digits as needed. */
export function fraction(z: { millisecond: number; microsecond: number; nanosecond: number }, mode: 'auto' | 'ms' | 'none' = 'auto'): string {
  if (mode === 'none') return ''
  if (mode === 'ms') return `.${pad(z.millisecond, 3)}`
  if (z.nanosecond) return `.${pad(z.millisecond, 3)}${pad(z.microsecond, 3)}${pad(z.nanosecond, 3)}`
  if (z.microsecond) return `.${pad(z.millisecond, 3)}${pad(z.microsecond, 3)}`
  if (z.millisecond) return `.${pad(z.millisecond, 3)}`
  return ''
}

function datePart(z: Temporal.ZonedDateTime) {
  return `${isoYear(z.year)}-${pad(z.month)}-${pad(z.day)}`
}
function timePart(z: Temporal.ZonedDateTime) {
  return `${pad(z.hour)}:${pad(z.minute)}:${pad(z.second)}`
}

/** "+05:45"; "Z" when `zulu` and offset is zero. Sub-minute historical offsets keep seconds. */
function offsetText(z: Temporal.ZonedDateTime, zulu: boolean): string {
  if (zulu && z.offsetNanoseconds === 0) return 'Z'
  return z.offset
}

/** ISO 8601 in UTC with milliseconds, exactly like Date#toISOString. */
export function isoUtc(epochNs: bigint): string {
  const z = toZoned(epochNs, 'UTC')
  return `${datePart(z)}T${timePart(z)}${fraction(z, 'ms')}Z`
}

/** ISO 8601 with the zone's offset and milliseconds: 2024-03-10T09:30:00.000-04:00. */
export function isoWithOffset(epochNs: bigint, zone: string): string {
  const z = toZoned(epochNs, zone)
  return `${datePart(z)}T${timePart(z)}${fraction(z, 'ms')}${offsetText(z, false)}`
}

/** RFC 3339: offset form, fractional seconds only when non-zero, Z for UTC. */
export function rfc3339(epochNs: bigint, zone: string): string {
  const z = toZoned(epochNs, zone)
  return `${datePart(z)}T${timePart(z)}${fraction(z)}${offsetText(z, zone === 'UTC')}`
}

/** RFC 9557 / Temporal string with bracketed zone: 2024-03-10T09:30:00-04:00[America/New_York]. */
export function rfc9557(epochNs: bigint, zone: string): string {
  return toZoned(epochNs, zone).toString()
}

/** RFC 2822 (email) date: "Sun, 10 Mar 2024 09:30:00 -0400". Years must be ≥ 1900 to be valid. */
export function rfc2822(epochNs: bigint, zone: string): string {
  const z = toZoned(epochNs, zone)
  const off = z.offset.replace(':', '').slice(0, 5)
  return `${DAY_ABBR[z.dayOfWeek - 1]}, ${pad(z.day)} ${MONTH_ABBR[z.month - 1]} ${z.year < 0 ? z.year : pad(z.year, 4)} ${timePart(z)} ${off}`
}

/** RFC 7231 HTTP-date (IMF-fixdate), always GMT: "Sun, 10 Mar 2024 13:30:00 GMT". */
export function httpDate(epochNs: bigint): string {
  const z = toZoned(epochNs, 'UTC')
  return `${DAY_ABBR[z.dayOfWeek - 1]}, ${pad(z.day)} ${MONTH_ABBR[z.month - 1]} ${z.year < 0 ? z.year : pad(z.year, 4)} ${timePart(z)} GMT`
}

/** SQL DATETIME literal in a zone (no offset): "2024-03-10 09:30:00" (+ fraction if any). */
export function sqlDateTime(epochNs: bigint, zone: string): string {
  const z = toZoned(epochNs, zone)
  return `${datePart(z)} ${timePart(z)}${fraction(z)}`
}

/** "2024-03-10 09:30:00" (+ fraction when non-zero). */
export function wallClock(epochNs: bigint, zone: string): string {
  return sqlDateTime(epochNs, zone)
}

/** Exact decimal Unix value in a unit, with as many fraction digits as needed. */
export function unixValue(epochNs: bigint, unit: 's' | 'ms' | 'us' | 'ns'): string {
  const div = { s: 1_000_000_000n, ms: 1_000_000n, us: 1_000n, ns: 1n }[unit]
  const neg = epochNs < 0n
  const a = neg ? -epochNs : epochNs
  const int = a / div
  const rem = a % div
  let s = int.toString()
  if (rem) {
    const digits = div.toString().length - 1
    s += '.' + rem.toString().padStart(digits, '0').replace(/0+$/, '')
  }
  return neg ? `-${s}` : s
}

/** Unix seconds floored (what most APIs expect): -1.5 s → -2. */
export function unixSecondsFloor(epochNs: bigint): bigint {
  const q = epochNs / 1_000_000_000n
  return epochNs < 0n && epochNs % 1_000_000_000n !== 0n ? q - 1n : q
}

// ── Relative time ─────────────────────────────────────────────────────────

export type RelUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

/**
 * Picks a unit like humans do (moment-style thresholds) and returns a signed value:
 * < 45 s → seconds, < 45 min → minutes, < 22 h → hours, < 26 d → days, < 320 d → months, else years.
 */
export function relativeParts(deltaMs: number): { value: number; unit: RelUnit } {
  const abs = Math.abs(deltaMs)
  const sign = deltaMs < 0 ? -1 : 1
  const s = abs / 1000
  if (s < 45) return { value: sign * Math.round(s), unit: 'second' }
  const min = s / 60
  if (min < 45) return { value: sign * Math.round(min), unit: 'minute' }
  const h = min / 60
  if (h < 22) return { value: sign * Math.round(h), unit: 'hour' }
  const d = h / 24
  if (d < 26) return { value: sign * Math.round(d), unit: 'day' }
  if (d < 320) return { value: sign * Math.max(1, Math.round(d / 30.436875)), unit: 'month' }
  return { value: sign * Math.max(1, Math.round(d / 365.2425)), unit: 'year' }
}

const rtfCache = new Map<string, Intl.RelativeTimeFormat>()
/** "3 days ago" / "in 2 hours" / "now" for target relative to now. */
export function formatRelative(targetMs: number, nowMs: number, locale = 'en', numeric: 'auto' | 'always' = 'always'): string {
  const { value, unit } = relativeParts(targetMs - nowMs)
  const key = `${locale}|${numeric}`
  let rtf = rtfCache.get(key)
  if (!rtf) {
    try {
      rtf = new Intl.RelativeTimeFormat(locale, { numeric })
    } catch {
      rtf = new Intl.RelativeTimeFormat('en', { numeric })
    }
    rtfCache.set(key, rtf)
  }
  if (unit === 'second' && Math.abs(value) < 1) {
    try {
      return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second')
    } catch {
      return 'now'
    }
  }
  return rtf.format(value, unit)
}

/** Precise compound relative text: "2 d 4 h 3 m ago", "in 45 s". */
export function formatRelativePrecise(targetMs: number, nowMs: number): string {
  const delta = targetMs - nowMs
  let s = Math.floor(Math.abs(delta) / 1000)
  if (s === 0) return 'now'
  const parts: string[] = []
  const units: [number, string][] = [
    [365 * 86400, 'y'],
    [86400, 'd'],
    [3600, 'h'],
    [60, 'm'],
    [1, 's'],
  ]
  for (const [size, label] of units) {
    if (s >= size) {
      parts.push(`${Math.floor(s / size)} ${label}`)
      s %= size
    }
    if (parts.length === 3) break
  }
  const text = parts.join(' ')
  return delta < 0 ? `${text} ago` : `in ${text}`
}

// ── Calendar facts ──────────────────────────────────────────────────────────

export interface CalendarFacts {
  dayOfWeek: string
  /** ISO 8601 week date, e.g. "2024-W10-7". */
  isoWeekDate: string
  isoWeek: number
  isoWeekYear: number
  dayOfYear: number
  daysInYear: number
  leapYear: boolean
  quarter: number
}

export function calendarFacts(epochNs: bigint, zone: string): CalendarFacts {
  const z = toZoned(epochNs, zone)
  const week = z.weekOfYear ?? 0
  const wy = z.yearOfWeek ?? z.year
  return {
    dayOfWeek: DAY_LONG[z.dayOfWeek - 1],
    isoWeekDate: `${isoYear(wy)}-W${pad(week)}-${z.dayOfWeek}`,
    isoWeek: week,
    isoWeekYear: wy,
    dayOfYear: z.dayOfYear,
    daysInYear: z.daysInYear,
    leapYear: z.inLeapYear,
    quarter: Math.ceil(z.month / 3),
  }
}

export interface ZonedText {
  /** "2024-03-10 09:30:00" */
  wall: string
  /** "EDT" or "GMT+5:45" */
  abbreviation: string
  /** "Eastern Daylight Time" */
  longName: string
  offset: string
  zone: string
}

export function zonedText(epochNs: bigint, zone: string): ZonedText {
  const z = toZoned(epochNs, zone)
  const ms = Number(epochNs / 1_000_000n)
  return {
    wall: `${datePart(z)} ${timePart(z)}${fraction(z)}`,
    abbreviation: zoneAbbreviation(ms, zone),
    longName: zoneLongName(ms, zone),
    offset: z.offset,
    zone,
  }
}

export type IntlStyle = 'full' | 'long' | 'medium' | 'short'
export interface IntlPreset {
  label: string
  options: Intl.DateTimeFormatOptions
  value: string
}

const intlCache = new Map<string, Intl.DateTimeFormat>()
/** Formats with Intl.DateTimeFormat (cached); falls back to en-US for unsupported locales. */
export function intlFormat(epochMs: number, zone: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const key = `${locale}|${zone}|${JSON.stringify(options)}`
  let f = intlCache.get(key)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone })
    } catch {
      f = new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone })
    }
    intlCache.set(key, f)
  }
  return f.format(epochMs)
}

/** The locale's date/time style presets (dateStyle/timeStyle full → short, and combinations). */
export function intlPresets(epochMs: number, zone: string, locale: string): IntlPreset[] {
  const styles: IntlStyle[] = ['full', 'long', 'medium', 'short']
  const out: IntlPreset[] = []
  for (const s of styles) out.push({ label: `Date · ${s}`, options: { dateStyle: s }, value: '' })
  for (const s of styles) out.push({ label: `Time · ${s}`, options: { timeStyle: s }, value: '' })
  out.push({ label: 'Date + time · long / short', options: { dateStyle: 'long', timeStyle: 'short' }, value: '' })
  out.push({ label: 'Date + time · medium', options: { dateStyle: 'medium', timeStyle: 'medium' }, value: '' })
  out.push({ label: 'Date + time · short', options: { dateStyle: 'short', timeStyle: 'short' }, value: '' })
  for (const p of out) p.value = intlFormat(epochMs, zone, locale, p.options)
  return out
}

/** Resolved locale actually used by Intl (e.g. "xx" → "en-US"). */
export function resolvedLocale(locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale).resolvedOptions().locale
  } catch {
    return 'en-US'
  }
}

export { DAY_ABBR, DAY_LONG, MONTH_ABBR }
