import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { addDuration, businessDaysBetween, difference, EMPTY_DURATION, humanizeDuration } from './difference'

const z = (s: string) => Temporal.ZonedDateTime.from(s)
const d = (s: string) => Temporal.PlainDate.from(s)

describe('difference', () => {
  it('a DST spring-forward day is 23 hours (America/New_York 2024-03-10)', () => {
    const r = difference(z('2024-03-09T12:00[America/New_York]'), z('2024-03-11T12:00[America/New_York]'), 'days')
    expect(r.duration.toString()).toBe('P2D')
    expect(r.totals.hours).toBe(47)
    expect(r.totals.days).toBe(2)
    expect(r.elapsedMs).toBe(47 * 3_600_000)
    expect(r.irregularDays).toEqual([{ date: '2024-03-10', hours: 23 }])
    expect(r.transitions).toHaveLength(1)
    expect(r.transitions[0].deltaMinutes).toBe(60)
    expect(difference(z('2024-03-09T12:00[America/New_York]'), z('2024-03-11T12:00[America/New_York]'), 'hours').duration.toString()).toBe('PT47H')
  })

  it('a fall-back day is 25 hours (America/New_York 2024-11-03)', () => {
    const r = difference(z('2024-11-02T12:00[America/New_York]'), z('2024-11-04T12:00[America/New_York]'), 'days')
    expect(r.totals.hours).toBe(49)
    expect(r.irregularDays).toEqual([{ date: '2024-11-03', hours: 25 }])
  })

  it('Europe/London spring-forward', () => {
    const r = difference(z('2024-03-30T00:00[Europe/London]'), z('2024-04-01T00:00[Europe/London]'), 'hours')
    expect(r.duration.hours).toBe(47)
    expect(r.irregularDays).toEqual([{ date: '2024-03-31', hours: 23 }])
  })

  it('calendar-aware months across a leap February', () => {
    const r = difference(z('2024-01-31T00:00[UTC]'), z('2024-03-01T00:00[UTC]'), 'years')
    expect(r.duration.toString()).toBe('P1M1D')
    expect(r.totals.days).toBe(30)
    expect(r.calendarDays).toBe(30)
    expect(difference(z('2023-01-31T00:00[UTC]'), z('2023-03-01T00:00[UTC]'), 'days').duration.days).toBe(29)
  })

  it('largest unit options', () => {
    const a = z('2020-02-29T10:00[UTC]')
    const b = z('2024-03-15T12:30:15[UTC]')
    expect(difference(a, b, 'years').duration.toString()).toBe('P4Y15DT2H30M15S')
    expect(difference(a, b, 'months').duration.toString()).toBe('P48M15DT2H30M15S')
    expect(difference(a, b, 'weeks').duration.weeks).toBe(210)
    expect(difference(a, b, 'days').duration.days).toBe(1476)
    expect(difference(a, b, 'seconds').duration.seconds).toBe(127_535_415)
  })

  it('negative direction: sign and absolute duration', () => {
    const r = difference(z('2024-03-11T00:00[UTC]'), z('2024-03-01T00:00[UTC]'), 'days')
    expect(r.sign).toBe(-1)
    expect(r.duration.toString()).toBe('P10D')
    expect(r.iso).toBe('-P10D')
    expect(r.totals.days).toBe(-10)
    expect(r.businessDays).toBe(6) // Fri 1st + Mon 4th … Fri 8th
    expect(difference(z('2024-03-01T00:00[UTC]'), z('2024-03-01T00:00[UTC]'), 'days').sign).toBe(0)
  })

  it('converts the end into the start zone', () => {
    const r = difference(z('2024-01-01T00:00[Asia/Tokyo]'), z('2024-01-01T00:00[UTC]'), 'hours')
    expect(r.duration.hours).toBe(9)
  })
})

describe('business days (Mon–Fri, no holidays)', () => {
  it('counts [start, end)', () => {
    expect(businessDaysBetween(d('2024-01-01'), d('2024-01-08'))).toBe(5) // Mon → Mon
    expect(businessDaysBetween(d('2024-01-05'), d('2024-01-08'))).toBe(1) // Fri → Mon
    expect(businessDaysBetween(d('2024-01-06'), d('2024-01-08'))).toBe(0) // Sat → Mon
    expect(businessDaysBetween(d('2024-01-01'), d('2024-01-01'))).toBe(0)
    expect(businessDaysBetween(d('2024-01-08'), d('2024-01-01'))).toBe(0)
  })
  it('matches brute force over a long range', () => {
    let brute = 0
    for (let x = d('1999-12-25'); Temporal.PlainDate.compare(x, d('2031-02-03')) < 0; x = x.add({ days: 1 })) if (x.dayOfWeek <= 5) brute++
    expect(businessDaysBetween(d('1999-12-25'), d('2031-02-03'))).toBe(brute)
    let early = 0
    for (let x = d('0050-01-01'); Temporal.PlainDate.compare(x, d('0050-03-01')) < 0; x = x.add({ days: 1 })) if (x.dayOfWeek <= 5) early++
    expect(businessDaysBetween(d('0050-01-01'), d('0050-03-01'))).toBe(early)
  })
})

describe('addDuration', () => {
  it('clamps month ends and explains it', () => {
    const r = addDuration(z('2024-01-31T10:00[UTC]'), { ...EMPTY_DURATION, months: 1 }, 'add')
    expect(r.ok && r.result.toPlainDate().toString()).toBe('2024-02-29')
    expect(r.ok && r.clamped).toBe(true)
    expect(r.ok && r.notes[0]).toMatch(/February 31.*clamped.*February 29/)
    const r2 = addDuration(z('2023-01-31T10:00[UTC]'), { ...EMPTY_DURATION, months: 1 }, 'add')
    expect(r2.ok && r2.result.toPlainDate().toString()).toBe('2023-02-28')
    const back = addDuration(z('2024-03-31T10:00[UTC]'), { ...EMPTY_DURATION, months: 1 }, 'subtract')
    expect(back.ok && back.result.toPlainDate().toString()).toBe('2024-02-29')
    const leap = addDuration(z('2024-02-29T00:00[UTC]'), { ...EMPTY_DURATION, years: 1 }, 'add')
    expect(leap.ok && leap.result.toPlainDate().toString()).toBe('2025-02-28')
  })

  it('reject overflow refuses non-existent dates', () => {
    const r = addDuration(z('2024-01-31T10:00[UTC]'), { ...EMPTY_DURATION, months: 1 }, 'add', 'reject')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/February 31, 2024 doesn’t exist/)
  })

  it('days keep the wall clock across DST; hours are exact', () => {
    const base = z('2024-03-09T12:00[America/New_York]')
    const day = addDuration(base, { ...EMPTY_DURATION, days: 1 }, 'add')
    expect(day.ok && day.result.toString()).toBe('2024-03-10T12:00:00-04:00[America/New_York]')
    expect(day.ok && day.notes.join(' ')).toMatch(/elapsed time is 23 h/)
    const hours = addDuration(base, { ...EMPTY_DURATION, hours: 24 }, 'add')
    expect(hours.ok && hours.result.toString()).toBe('2024-03-10T13:00:00-04:00[America/New_York]')
  })

  it('moves a result that lands in a DST gap forward', () => {
    const r = addDuration(z('2024-03-09T02:30[America/New_York]'), { ...EMPTY_DURATION, days: 1 }, 'add')
    expect(r.ok && r.result.toString()).toBe('2024-03-10T03:30:00-04:00[America/New_York]')
    expect(r.ok && r.dstShift).toBe(true)
  })

  it('applies all units in Temporal order', () => {
    const r = addDuration(z('2024-01-31T23:00[UTC]'), { years: 1, months: 1, weeks: 1, days: 1, hours: 2, minutes: 30, seconds: 15 }, 'add')
    // 2025-02-28 (clamped) + 1 w 1 d = 2025-03-08 23:00, + 2:30:15 = 2025-03-09 01:30:15
    expect(r.ok && r.result.toString()).toBe('2025-03-09T01:30:15+00:00[UTC]')
  })

  it('validates input and range', () => {
    expect(addDuration(z('2024-01-01T00:00[UTC]'), { ...EMPTY_DURATION, days: 1.5 }, 'add').ok).toBe(false)
    const far = addDuration(z('2024-01-01T00:00[UTC]'), { ...EMPTY_DURATION, years: 300000 }, 'add')
    expect(far.ok).toBe(false)
  })

  it('humanizes durations', () => {
    expect(humanizeDuration(Temporal.Duration.from('P1Y2M3DT4H'))).toBe('1 year, 2 months, 3 days, 4 hours')
    expect(humanizeDuration(Temporal.Duration.from('PT0S'))).toBe('0 seconds')
    expect(humanizeDuration(Temporal.Duration.from('-P1D'))).toBe('1 day')
  })
})
