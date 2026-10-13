import { Temporal } from 'temporal-polyfill'
import { transitionsBetween, type ZoneTransition } from './zones'

/** Calendar-aware differences and duration arithmetic (Temporal, DST-correct). */

export type LargestUnit = 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds'

export const DURATION_UNITS = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds', 'milliseconds'] as const
export type DurationUnit = (typeof DURATION_UNITS)[number]

export interface DifferenceResult {
  /** Sign of end − start: 1 (end later), -1 (end earlier), 0 (same instant). */
  sign: -1 | 0 | 1
  /** Absolute calendar duration (positive fields). */
  duration: Temporal.Duration
  /** ISO 8601 duration string (signed). */
  iso: string
  /** Totals of the signed difference in each unit (calendar-aware for years…days). */
  totals: Record<DurationUnit, number>
  /** Elapsed exact time in ms (end − start). */
  elapsedMs: number
  /** Mon–Fri dates from the earlier date (inclusive) to the later date (exclusive). */
  businessDays: number
  /** Calendar days between the two dates ignoring time of day (later − earlier). */
  calendarDays: number
  /** DST/offset transitions crossed (in the start zone). */
  transitions: ZoneTransition[]
  transitionsTruncated: boolean
  /** Days in the interval that are not 24 hours long, with their length. */
  irregularDays: { date: string; hours: number }[]
}

/** 1970-01-01 is a Thursday (ISO weekday 4). */
function isoWeekdayOfEpochDay(n: number): number {
  return ((((n + 3) % 7) + 7) % 7) + 1
}

function epochDay(d: Temporal.PlainDate): number {
  return Math.round(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000) // Date.UTC handles year < 100 incorrectly
}

function epochDayExact(d: Temporal.PlainDate): number {
  return d.since(Temporal.PlainDate.from('1970-01-01'), { largestUnit: 'days' }).days
}

/** Count of Monday–Friday dates in [from, to). Holidays are not considered. */
export function businessDaysBetween(from: Temporal.PlainDate, to: Temporal.PlainDate): number {
  const a = from.year >= 100 ? epochDay(from) : epochDayExact(from)
  const b = to.year >= 100 ? epochDay(to) : epochDayExact(to)
  if (b <= a) return 0
  const span = b - a
  const weeks = Math.floor(span / 7)
  let count = weeks * 5
  const startWd = isoWeekdayOfEpochDay(a)
  for (let i = 0; i < span % 7; i++) {
    const wd = ((startWd - 1 + i) % 7) + 1
    if (wd <= 5) count++
  }
  return count
}

/**
 * Difference end − start. Both must be ZonedDateTimes in the same zone for calendar units;
 * if they differ, `end` is converted into `start`'s zone (the instant is unchanged).
 */
export function difference(start: Temporal.ZonedDateTime, endIn: Temporal.ZonedDateTime, largestUnit: LargestUnit): DifferenceResult {
  const end = endIn.timeZoneId === start.timeZoneId ? endIn : endIn.withTimeZone(start.timeZoneId)
  const cmp = Temporal.ZonedDateTime.compare(start, end) * -1
  const sign = (cmp === 0 ? 0 : cmp) as -1 | 0 | 1
  const signed = start.until(end, { largestUnit, smallestUnit: 'nanoseconds' })
  const totals = {} as Record<DurationUnit, number>
  const full = start.until(end, { largestUnit: 'years' })
  for (const unit of DURATION_UNITS) totals[unit] = full.total({ unit, relativeTo: start })
  const [lo, hi] = sign >= 0 ? [start, end] : [end, start]
  const { list, truncated } = transitionsBetween(lo.epochMilliseconds, hi.epochMilliseconds, start.timeZoneId, 200)
  const irregular: { date: string; hours: number }[] = []
  const seen = new Set<string>()
  for (const t of list) {
    const day = Temporal.Instant.fromEpochMilliseconds(t.epochMs).toZonedDateTimeISO(start.timeZoneId)
    const date = day.toPlainDate().toString()
    if (seen.has(date)) continue
    seen.add(date)
    const hours = day.hoursInDay
    if (hours !== 24) irregular.push({ date, hours })
  }
  return {
    sign,
    duration: signed.abs(),
    iso: signed.toString(),
    totals,
    elapsedMs: end.epochMilliseconds - start.epochMilliseconds,
    businessDays: businessDaysBetween(lo.toPlainDate(), hi.toPlainDate()),
    calendarDays: Math.abs(start.toPlainDate().until(end.toPlainDate(), { largestUnit: 'days' }).days),
    transitions: list,
    transitionsTruncated: truncated,
    irregularDays: irregular,
  }
}

/** "1 year, 2 months, 3 days, 4 hours" — zero fields omitted; "0 seconds" when empty. */
export function humanizeDuration(d: Temporal.Duration, maxParts = 7): string {
  const fields: [number, string][] = [
    [d.years, 'year'],
    [d.months, 'month'],
    [d.weeks, 'week'],
    [d.days, 'day'],
    [d.hours, 'hour'],
    [d.minutes, 'minute'],
    [d.seconds, 'second'],
  ]
  const parts = fields.filter(([n]) => n !== 0).map(([n, u]) => `${Math.abs(n).toLocaleString('en-US')} ${u}${Math.abs(n) === 1 ? '' : 's'}`)
  const ms = Math.abs(d.milliseconds)
  if (ms) parts.push(`${ms} ms`)
  if (!parts.length) return '0 seconds'
  return parts.slice(0, maxParts).join(', ')
}

// ── Duration arithmetic ────────────────────────────────────────────────────

export interface DurationInput {
  years: number
  months: number
  weeks: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

export const EMPTY_DURATION: DurationInput = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }

export interface AddResult {
  ok: true
  result: Temporal.ZonedDateTime
  /** Plain-language explanations of anything non-obvious (clamping, DST). */
  notes: string[]
  clamped: boolean
  dstShift: boolean
}

export type AddOutcome = AddResult | { ok: false; message: string }

const DAYS_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * base ± duration in Temporal order: years and months (day clamped to month end unless
 * overflow = 'reject'), then weeks and days on the wall clock, then hours/minutes/seconds as
 * exact elapsed time.
 */
export function addDuration(base: Temporal.ZonedDateTime, input: DurationInput, op: 'add' | 'subtract', overflow: 'constrain' | 'reject' = 'constrain'): AddOutcome {
  for (const [k, v] of Object.entries(input)) {
    if (!Number.isFinite(v) || !Number.isInteger(v)) return { ok: false, message: `${k} must be a whole number.` }
  }
  const s = op === 'add' ? 1 : -1
  let dur: Temporal.Duration
  try {
    dur = Temporal.Duration.from({
      years: s * input.years,
      months: s * input.months,
      weeks: s * input.weeks,
      days: s * input.days,
      hours: s * input.hours,
      minutes: s * input.minutes,
      seconds: s * input.seconds,
    })
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
  const notes: string[] = []
  let clamped = false
  let dstShift = false
  try {
    // Calendar part (Y/M) — detect month-end clamping.
    if (input.years || input.months) {
      const ym = { years: s * input.years, months: s * input.months }
      const target = base.toPlainDate().toPlainYearMonth().add(ym)
      if (base.day > target.daysInMonth) {
        clamped = true
        if (overflow === 'reject') {
          return { ok: false, message: `${DAYS_NAMES[target.month - 1]} ${base.day}, ${target.year} doesn’t exist (${DAYS_NAMES[target.month - 1]} has ${target.daysInMonth} days). Switch overflow to “Clamp” to use the last day of the month.` }
        }
        notes.push(
          `${DAYS_NAMES[base.month - 1]} ${base.day} ${op === 'add' ? '+' : '−'} ${describeYM(input)} lands on ${DAYS_NAMES[target.month - 1]} ${base.day}, which doesn’t exist — clamped to the last day, ${DAYS_NAMES[target.month - 1]} ${target.daysInMonth}. Years and months are applied first, then the day is clamped, then weeks/days/time are added.`,
        )
      }
    }
    const calendarPart = base.add({ years: dur.years, months: dur.months, weeks: dur.weeks, days: dur.days }, { overflow })
    const expectedWall = base.toPlainDateTime().add({ years: dur.years, months: dur.months, weeks: dur.weeks, days: dur.days }, { overflow })
    if (!calendarPart.toPlainDateTime().equals(expectedWall)) {
      dstShift = true
      notes.push(
        `${fmtWall(expectedWall)} doesn’t exist in ${base.timeZoneId} (clocks spring forward), so the result moves to ${fmtWall(calendarPart.toPlainDateTime())} ${calendarPart.offset}.`,
      )
    } else if ((input.weeks || input.days) && calendarPart.offsetNanoseconds !== base.offsetNanoseconds) {
      const elapsedH = (calendarPart.epochMilliseconds - base.epochMilliseconds) / 3_600_000
      notes.push(
        `Crosses a DST change: days are calendar days, so the wall-clock time stays ${pad2(base.hour)}:${pad2(base.minute)} while the elapsed time is ${Math.abs(elapsedH).toLocaleString('en-US', { maximumFractionDigits: 2 })} h, not ${Math.abs((input.weeks * 7 + input.days) * 24)} h.`,
      )
    }
    const result = base.add(dur, { overflow })
    if ((input.hours || input.minutes || input.seconds) && result.offsetNanoseconds !== calendarPart.offsetNanoseconds) {
      notes.push(`Hours, minutes and seconds are exact elapsed time; a DST change in that span shifts the wall clock (${calendarPart.offset} → ${result.offset}).`)
    }
    return { ok: true, result, notes, clamped, dstShift }
  } catch (e) {
    const msg = (e as Error).message
    if (/out-of-bounds|out of range|outside/i.test(msg)) return { ok: false, message: 'The result is outside the supported range (years -271821 to 275760).' }
    return { ok: false, message: msg }
  }
}

function describeYM(d: DurationInput) {
  const p: string[] = []
  if (d.years) p.push(`${d.years} year${d.years === 1 ? '' : 's'}`)
  if (d.months) p.push(`${d.months} month${d.months === 1 ? '' : 's'}`)
  return p.join(' ')
}

const pad2 = (n: number) => String(n).padStart(2, '0')
function fmtWall(p: Temporal.PlainDateTime) {
  return `${p.toPlainDate().toString()} ${pad2(p.hour)}:${pad2(p.minute)}`
}
