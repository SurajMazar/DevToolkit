import { Temporal } from 'temporal-polyfill'

/**
 * Smart date/time input detection: Unix numbers (unit by magnitude, overridable), ISO 8601 /
 * RFC 9557, RFC 2822, HTTP dates (RFC 7231), and — flagged as ambiguous — anything the
 * browser's Date parser accepts. Everything resolves to an exact instant in epoch nanoseconds.
 */

export type NumericUnit = 's' | 'ms' | 'us' | 'ns'

export type InputKind =
  | 'unix'
  | 'iso-instant'
  | 'iso-zoned'
  | 'iso-local'
  | 'iso-date'
  | 'rfc2822'
  | 'http-date'
  | 'browser'

export interface ParsedInput {
  ok: true
  kind: InputKind
  /** Short label for the detected format, e.g. "Unix milliseconds", "ISO 8601 with offset". */
  label: string
  epochNs: bigint
  /** How the value was interpreted (offset-less input, assumed zone…). */
  note?: string
  warnings: string[]
  /** For numbers: the unit used and the one auto-detection picked. */
  unit?: NumericUnit
  autoUnit?: NumericUnit
  /** For zoned ISO input (`…[Europe/Paris]`): the zone in the annotation. */
  zone?: string
  /** Original UTC offset written in the input, if any ("+05:30", "Z"). */
  offset?: string
}

export interface ParseError {
  ok: false
  message: string
  kind?: InputKind
}

export type ParseResult = ParsedInput | ParseError

export interface ParseOptions {
  /** Force a unit for numeric input; 'auto' uses magnitude. */
  unit?: NumericUnit | 'auto'
  /** Zone used to interpret ISO input without an offset. */
  zone: string
  /** Fallback disambiguation for offset-less wall times that are skipped or repeated. */
  disambiguation?: 'compatible' | 'earlier' | 'later'
  /** "Now" (epoch ms) — only used for RFC 850 two-digit years. */
  nowMs?: number
  /** Allow the browser `Date` parser as a last resort (default true). */
  allowBrowser?: boolean
}

export const UNIT_LABELS: Record<NumericUnit, string> = {
  s: 'Unix seconds',
  ms: 'Unix milliseconds',
  us: 'Unix microseconds',
  ns: 'Unix nanoseconds',
}

const NS_PER: Record<NumericUnit, bigint> = { s: 1_000_000_000n, ms: 1_000_000n, us: 1_000n, ns: 1n }

/** Largest representable instant (same as JS Date): ±8.64e15 ms. */
export const MAX_EPOCH_NS = 8_640_000_000_000_000_000_000n

/**
 * Auto-detects the unit of a Unix number by magnitude of its integer part:
 * |n| < 1e11 → seconds (until year 5138), < 1e14 → ms, < 1e17 → µs, otherwise ns.
 */
export function detectUnit(intPart: bigint): NumericUnit {
  const a = intPart < 0n ? -intPart : intPart
  if (a < 100_000_000_000n) return 's'
  if (a < 100_000_000_000_000n) return 'ms'
  if (a < 100_000_000_000_000_000n) return 'us'
  return 'ns'
}

const NUMERIC = /^([+-]?)(\d+)(?:\.(\d+))?$/

/** Converts a decimal Unix number string to epoch ns without floating-point loss. */
export function numberToEpochNs(text: string, unit: NumericUnit): { epochNs: bigint; truncatedDigits: boolean } | null {
  const m = NUMERIC.exec(text)
  if (!m) return null
  const neg = m[1] === '-'
  const scale = NS_PER[unit]
  const scaleDigits = scale.toString().length - 1
  const frac = m[3] ?? ''
  const kept = frac.slice(0, scaleDigits).padEnd(scaleDigits, '0')
  const truncatedDigits = frac.length > scaleDigits && /[1-9]/.test(frac.slice(scaleDigits))
  let ns = BigInt(m[2]) * scale + (scaleDigits ? BigInt(kept) : 0n)
  if (neg) ns = -ns
  return { epochNs: ns, truncatedDigits }
}

export function inRange(epochNs: bigint): boolean {
  return epochNs >= -MAX_EPOCH_NS && epochNs <= MAX_EPOCH_NS
}

const RANGE_MESSAGE = 'Out of range — supported instants are between -271821-04-20 and +275760-09-13 (±8.64 × 10¹⁵ ms from 1970, the same limits as JavaScript Date).'

function rangeError(kind: InputKind, extra = ''): ParseError {
  return { ok: false, kind, message: extra ? `${RANGE_MESSAGE} ${extra}` : RANGE_MESSAGE }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const LONG_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

/** RFC 2822 §4.3 obsolete zone names. Military single letters are treated as -0000 (unknown). */
const OBS_ZONES: Record<string, number> = { UT: 0, GMT: 0, Z: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 }

function zoneMinutes(z: string): { minutes: number; warning?: string } | null {
  const up = z.toUpperCase()
  if (up in OBS_ZONES) return { minutes: OBS_ZONES[up] }
  const m = /^([+-])(\d{2})(\d{2})$/.exec(z)
  if (m) {
    const mins = Number(m[2]) * 60 + Number(m[3])
    if (Number(m[3]) > 59) return null
    if (z === '-0000') return { minutes: 0, warning: '“-0000” means the sender’s local offset is unknown; the time is treated as UTC.' }
    return { minutes: m[1] === '-' ? -mins : mins }
  }
  if (/^[A-IK-Z]$/i.test(z)) return { minutes: 0, warning: `Military zone “${z}” is unreliable (RFC 2822 §4.3) and is treated as UTC.` }
  return null
}

function buildInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  offsetMinutes: number,
): bigint | string {
  try {
    const pdt = Temporal.PlainDateTime.from({ year, month, day, hour, minute, second }, { overflow: 'reject' })
    const sign = offsetMinutes < 0 ? '-' : '+'
    const a = Math.abs(offsetMinutes)
    const off = `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
    return pdt.toZonedDateTime(off).epochNanoseconds
  } catch (e) {
    return (e as Error).message
  }
}

function weekdayIndex(y: number, m: number, d: number): number {
  return Temporal.PlainDate.from({ year: y, month: m, day: d }).dayOfWeek - 1 // 0 = Monday
}

function twoDigitYear2822(y: string): number {
  const n = Number(y)
  if (y.length === 2) return n < 50 ? 2000 + n : 1900 + n
  if (y.length === 3) return 1900 + n
  return n
}

const RFC2822 =
  /^(?:([a-z]{3}),\s*)?(\d{1,2})\s+([a-z]{3})\s+(\d{2,4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+([+-]\d{4}|[a-z]{1,3})$/i

/** RFC 2822 / RFC 5322 date-time (also accepts the IMF-fixdate subset used by HTTP). */
export function parseRfc2822(text: string): { epochNs: bigint; warnings: string[]; isImfFixdate: boolean } | string | null {
  const t = text.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const m = RFC2822.exec(t)
  if (!m) return null
  const [, dow, dd, mon, yy, hh, mi, ss, zone] = m
  const month = MONTHS.indexOf(mon.toLowerCase()) + 1
  if (!month) return `“${mon}” is not a month name (Jan … Dec).`
  const z = zoneMinutes(zone)
  if (!z) return `“${zone}” is not a valid RFC 2822 zone (use ±hhmm, UT, GMT, EST, EDT, CST, CDT, MST, MDT, PST or PDT).`
  const year = twoDigitYear2822(yy)
  const second = ss ? Number(ss) : 0
  const warnings: string[] = []
  if (yy.length < 4) warnings.push(`Two-digit year “${yy}” read as ${year} (RFC 2822 obsolete syntax).`)
  if (z.warning) warnings.push(z.warning)
  // RFC 2822 allows second = 60 for leap seconds; Temporal/Unix time has none.
  let sec = second
  if (second === 60) {
    sec = 59
    warnings.push('Leap second :60 is not representable in Unix time; read as :59.')
  }
  const r = buildInstant(year, month, Number(dd), Number(hh), Number(mi), sec, z.minutes)
  if (typeof r === 'string') return r
  if (dow) {
    const di = DAYS.indexOf(dow.toLowerCase())
    if (di === -1) return `“${dow}” is not a day name (Mon … Sun).`
    if (di !== weekdayIndex(year, month, Number(dd))) warnings.push(`Day name “${dow}” doesn’t match the date (it was a ${capitalize(LONG_DAYS[weekdayIndex(year, month, Number(dd))])}).`)
  }
  const isImfFixdate = !!dow && dd.length === 2 && yy.length === 4 && !!ss && zone === 'GMT'
  return { epochNs: r, warnings, isImfFixdate }
}

const RFC850 = /^([a-z]+),\s*(\d{2})-([a-z]{3})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT$/i
const ASCTIME = /^([a-z]{3})\s+([a-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/i

/** Obsolete HTTP-date forms (RFC 7231 §7.1.1.1): RFC 850 and ANSI C asctime(). */
export function parseObsoleteHttpDate(text: string, nowMs: number): { epochNs: bigint; warnings: string[]; form: string } | string | null {
  const t = text.trim()
  let m = RFC850.exec(t)
  if (m) {
    const [, dow, dd, mon, yy, hh, mi, ss] = m
    const month = MONTHS.indexOf(mon.toLowerCase()) + 1
    if (!month) return `“${mon}” is not a month name.`
    // RFC 7231: a two-digit year that appears > 50 years in the future is in the past century.
    const nowYear = new Date(nowMs).getUTCFullYear()
    let year = Math.floor(nowYear / 100) * 100 + Number(yy)
    if (year > nowYear + 50) year -= 100
    const r = buildInstant(year, month, Number(dd), Number(hh), Number(mi), Number(ss), 0)
    if (typeof r === 'string') return r
    const warnings = [`Two-digit year “${yy}” read as ${year} (RFC 7231: never more than 50 years ahead).`]
    const di = LONG_DAYS.indexOf(dow.toLowerCase())
    if (di === -1) return `“${dow}” is not a full day name (Monday … Sunday).`
    if (di !== weekdayIndex(year, month, Number(dd))) warnings.push(`Day name “${dow}” doesn’t match the date.`)
    return { epochNs: r, warnings, form: 'RFC 850 (obsolete HTTP-date)' }
  }
  m = ASCTIME.exec(t)
  if (m) {
    const [, dow, mon, dd, hh, mi, ss, yyyy] = m
    const month = MONTHS.indexOf(mon.toLowerCase()) + 1
    if (!month) return `“${mon}” is not a month name.`
    const r = buildInstant(Number(yyyy), month, Number(dd), Number(hh), Number(mi), Number(ss), 0)
    if (typeof r === 'string') return r
    const warnings: string[] = ['asctime() dates carry no zone; read as GMT per RFC 7231.']
    const di = DAYS.indexOf(dow.toLowerCase())
    if (di === -1) return `“${dow}” is not a day name.`
    if (di !== weekdayIndex(Number(yyyy), month, Number(dd))) warnings.push(`Day name “${dow}” doesn’t match the date.`)
    return { epochNs: r, warnings, form: 'asctime() (obsolete HTTP-date)' }
  }
  return null
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Normalizes common ISO spellings Temporal is strict about ("2024-03-10 14:30" → "…T14:30"). */
function normalizeIso(text: string): string {
  return text.replace(/^([+-]?\d{4,6}-\d{2}-\d{2}) +(?=\d)/, '$1T').replace(/ +(?=(?:Z|[+-]\d{2}(?::?\d{2})?)(?:\[|$))/i, '')
}

const MONTH_NAMES_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Human message for out-of-range ISO fields (month 13, Feb 30, hour 25…), or null. */
function isoFieldProblem(iso: string): string | null {
  const m = /^([+-]?\d{4,6})-?(\d{2})-?(\d{2})(?:T(\d{2})(?::?(\d{2})(?::?(\d{2}))?)?)?/i.exec(iso)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12) return `Month ${m[2]} doesn’t exist — months are 01–12.`
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  if (day < 1 || day > dim) return `${MONTH_NAMES_LONG[month - 1]} ${year} has ${dim} days — day ${m[3]} doesn’t exist.`
  if (m[4] !== undefined && Number(m[4]) > 23) return `Hour ${m[4]} is out of range — hours are 00–23.`
  if (m[5] !== undefined && Number(m[5]) > 59) return `Minute ${m[5]} is out of range — minutes are 00–59.`
  if (m[6] !== undefined && Number(m[6]) > 59) return `Second ${m[6]} is out of range — leap seconds (:60) aren’t representable in Unix time.`
  return null
}

function offsetFromIso(text: string): string | undefined {
  const m = /(?:T[\d:.,]+)(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2})?)?)(?:\[|$)/i.exec(text)
  if (!m) return undefined
  return m[1].toUpperCase() === 'Z' ? 'Z' : m[1]
}

function looksIso(text: string): boolean {
  return /^[+-]?\d{4,6}-?\d{2}-?\d{2}(?:[T ]|$)/i.test(text)
}

/** Resolves an offset-less wall time in `zone`, describing gaps/overlaps. */
function wallToInstant(pdt: Temporal.PlainDateTime, zone: string, disambiguation: 'compatible' | 'earlier' | 'later') {
  const earlier = pdt.toZonedDateTime(zone, { disambiguation: 'earlier' })
  const later = pdt.toZonedDateTime(zone, { disambiguation: 'later' })
  const chosen = pdt.toZonedDateTime(zone, { disambiguation })
  let warning: string | undefined
  if (!earlier.toPlainDateTime().equals(pdt)) {
    warning = `${pdt.toString({ smallestUnit: 'minute' }).replace('T', ' ')} doesn’t exist in ${zone} (clocks skip forward); read as ${chosen.toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ')} ${chosen.offset}.`
  } else if (earlier.epochNanoseconds !== later.epochNanoseconds) {
    warning = `${pdt.toString({ smallestUnit: 'minute' }).replace('T', ' ')} happens twice in ${zone} (clocks fall back); using the ${chosen.epochNanoseconds === earlier.epochNanoseconds ? 'first' : 'second'} occurrence (${chosen.offset}).`
  }
  return { zdt: chosen, warning }
}

/**
 * Parses any supported date/time text into an exact instant.
 * Never guesses silently: ambiguous interpretations are labeled in `note` / `warnings`.
 */
export function parseDateInput(input: string, opts: ParseOptions): ParseResult {
  const text = input.trim()
  if (!text) return { ok: false, message: 'Empty input.' }
  const disamb = opts.disambiguation ?? 'compatible'

  // ── Unix numbers ────────────────────────────────────────────────────────
  const numText = text.replace(/_/g, '')
  const nm = NUMERIC.exec(numText)
  if (nm) {
    const autoUnit = detectUnit(BigInt(nm[1] + nm[2]))
    const unit = opts.unit && opts.unit !== 'auto' ? opts.unit : autoUnit
    const r = numberToEpochNs(numText, unit)!
    if (!inRange(r.epochNs)) return rangeError('unix', unit !== autoUnit ? `Auto-detection suggests ${UNIT_LABELS[autoUnit].toLowerCase()}.` : '')
    const warnings: string[] = []
    if (r.truncatedDigits) warnings.push('Digits below one nanosecond were ignored.')
    return {
      ok: true,
      kind: 'unix',
      label: UNIT_LABELS[unit],
      epochNs: r.epochNs,
      unit,
      autoUnit,
      warnings,
      note: unit === autoUnit ? `Detected by magnitude (${nm[2].length} integer digit${nm[2].length === 1 ? '' : 's'}).` : `Unit forced to ${unit}; magnitude suggests ${autoUnit}.`,
    }
  }
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    return { ok: false, kind: 'unix', message: 'Scientific notation isn’t accepted — write the timestamp out in full digits.' }
  }

  // ── ISO 8601 / RFC 9557 ─────────────────────────────────────────────────
  if (looksIso(text)) {
    const iso = normalizeIso(text)
    const fieldProblem = isoFieldProblem(iso)
    if (fieldProblem) return { ok: false, kind: 'iso-instant', message: fieldProblem }
    let lastError = ''
    if (iso.includes('[')) {
      try {
        const z = Temporal.ZonedDateTime.from(iso)
        const hasOffset = !!offsetFromIso(iso.split('[')[0])
        return {
          ok: true,
          kind: 'iso-zoned',
          label: 'ISO 8601 with time-zone annotation',
          epochNs: z.epochNanoseconds,
          zone: z.timeZoneId,
          offset: hasOffset ? offsetFromIso(iso.split('[')[0]) : undefined,
          warnings: [],
          note: hasOffset ? `Offset and zone ${z.timeZoneId} agree.` : `Wall-clock time in ${z.timeZoneId} (zone from the [annotation]).`,
        }
      } catch (e) {
        lastError = (e as Error).message
      }
    } else {
      const offset = offsetFromIso(iso)
      if (offset) {
        try {
          const inst = Temporal.Instant.from(iso)
          return {
            ok: true,
            kind: 'iso-instant',
            label: offset === 'Z' ? 'ISO 8601 UTC (Z)' : 'ISO 8601 with offset',
            epochNs: inst.epochNanoseconds,
            offset,
            warnings: [],
            note: offset === 'Z' ? 'Explicit UTC.' : `Explicit offset ${offset}.`,
          }
        } catch (e) {
          lastError = (e as Error).message
        }
      } else {
        try {
          const hasTime = /T/i.test(iso)
          const pdt = Temporal.PlainDateTime.from(iso, { overflow: 'reject' })
          const { zdt, warning } = wallToInstant(pdt, opts.zone, disamb)
          return {
            ok: true,
            kind: hasTime ? 'iso-local' : 'iso-date',
            label: hasTime ? 'ISO 8601 local (no offset)' : 'ISO 8601 date',
            epochNs: zdt.epochNanoseconds,
            warnings: warning ? [warning] : [],
            note: hasTime
              ? `No offset in the input — interpreted as wall-clock time in ${opts.zone}.`
              : `Date only — interpreted as the start of that day (00:00) in ${opts.zone}.`,
          }
        } catch (e) {
          lastError = (e as Error).message
        }
      }
    }
    if (/out-of-bounds date|date.*out of range/i.test(lastError)) return rangeError('iso-instant')
    if (/out-of-bounds offset/i.test(lastError)) return { ok: false, kind: 'iso-instant', message: 'UTC offset out of range — offsets must be between -23:59 and +23:59.' }
    const detail = lastError.replace(/^Temporal error:\s*/i, '').replace(/^Cannot parse:.*/, 'unrecognized structure').replace(/\.+$/, '')
    return { ok: false, kind: 'iso-instant', message: `Looks like ISO 8601 but isn’t valid: ${detail}.` }
  }

  // ── RFC 2822 / HTTP-date ────────────────────────────────────────────────
  const r2822 = parseRfc2822(text)
  if (typeof r2822 === 'string') return { ok: false, kind: 'rfc2822', message: r2822 }
  if (r2822) {
    return {
      ok: true,
      kind: r2822.isImfFixdate ? 'http-date' : 'rfc2822',
      label: r2822.isImfFixdate ? 'HTTP-date (RFC 7231 IMF-fixdate)' : 'RFC 2822',
      epochNs: r2822.epochNs,
      warnings: r2822.warnings,
      note: r2822.isImfFixdate ? 'Also valid RFC 2822.' : undefined,
    }
  }
  const http = parseObsoleteHttpDate(text, opts.nowMs ?? Date.now())
  if (typeof http === 'string') return { ok: false, kind: 'http-date', message: http }
  if (http) return { ok: true, kind: 'http-date', label: http.form, epochNs: http.epochNs, warnings: http.warnings }

  // ── Browser Date parser (last resort) ───────────────────────────────────
  if (opts.allowBrowser !== false) {
    const ms = Date.parse(text)
    if (!Number.isNaN(ms)) {
      return {
        ok: true,
        kind: 'browser',
        label: 'Browser-parsed',
        epochNs: BigInt(ms) * 1_000_000n,
        warnings: ['Browser-parsed, may be ambiguous: this format isn’t standardized. Day/month order and the time zone (usually this device’s) depend on the browser. Prefer ISO 8601.'],
      }
    }
  }
  return { ok: false, message: 'Unrecognized date/time. Try a Unix timestamp (1710079200), ISO 8601 (2024-03-10T14:00:00Z) or RFC 2822 (Sun, 10 Mar 2024 14:00:00 +0000).' }
}
