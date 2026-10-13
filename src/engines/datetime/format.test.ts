import { describe, expect, it } from 'vitest'
import {
  calendarFacts,
  intlFormat,
  intlPresets,
  resolvedLocale,
  formatRelative,
  formatRelativePrecise,
  httpDate,
  isoUtc,
  isoWithOffset,
  isoYear,
  relativeParts,
  rfc2822,
  rfc3339,
  rfc9557,
  sqlDateTime,
  unixSecondsFloor,
  unixValue,
  zonedText,
} from './format'

const T = 1_710_079_200_123_000_000n // 2024-03-10T14:00:00.123Z (after the NY spring-forward)
const S = 1_710_079_200_000_000_000n

describe('standard formats', () => {
  it('ISO 8601', () => {
    expect(isoUtc(T)).toBe('2024-03-10T14:00:00.123Z')
    expect(isoUtc(S)).toBe('2024-03-10T14:00:00.000Z')
    expect(isoWithOffset(T, 'America/New_York')).toBe('2024-03-10T10:00:00.123-04:00')
    expect(isoWithOffset(T, 'Asia/Kathmandu')).toBe('2024-03-10T19:45:00.123+05:45')
  })
  it('RFC 3339 keeps fractions only when needed and uses Z for UTC', () => {
    expect(rfc3339(S, 'UTC')).toBe('2024-03-10T14:00:00Z')
    expect(rfc3339(S, 'Europe/London')).toBe('2024-03-10T14:00:00+00:00')
    expect(rfc3339(T, 'America/New_York')).toBe('2024-03-10T10:00:00.123-04:00')
    expect(rfc3339(S + 5n, 'UTC')).toBe('2024-03-10T14:00:00.000000005Z')
  })
  it('RFC 9557, RFC 2822, HTTP-date and SQL', () => {
    expect(rfc9557(S, 'Europe/Paris')).toBe('2024-03-10T15:00:00+01:00[Europe/Paris]')
    expect(rfc2822(S, 'America/New_York')).toBe('Sun, 10 Mar 2024 10:00:00 -0400')
    expect(rfc2822(S, 'Asia/Kolkata')).toBe('Sun, 10 Mar 2024 19:30:00 +0530')
    expect(httpDate(S)).toBe('Sun, 10 Mar 2024 14:00:00 GMT')
    expect(sqlDateTime(T, 'UTC')).toBe('2024-03-10 14:00:00.123')
    expect(sqlDateTime(S, 'America/New_York')).toBe('2024-03-10 10:00:00')
  })
  it('years outside 0000–9999 use expanded ISO form', () => {
    expect(isoYear(2024)).toBe('2024')
    expect(isoYear(12)).toBe('0012')
    expect(isoYear(-1)).toBe('-000001')
    expect(isoYear(275760)).toBe('+275760')
    expect(isoUtc(-62_198_755_200_000_000_000n)).toBe('-000001-01-01T00:00:00.000Z')
  })
})

describe('unix values', () => {
  it('prints exact decimals in any unit', () => {
    expect(unixValue(T, 's')).toBe('1710079200.123')
    expect(unixValue(T, 'ms')).toBe('1710079200123')
    expect(unixValue(T + 456n, 'ms')).toBe('1710079200123.000456')
    expect(unixValue(-1_500_000_000n, 's')).toBe('-1.5')
    expect(unixValue(-1_500_000_000n, 'ms')).toBe('-1500')
    expect(unixValue(0n, 'ns')).toBe('0')
  })
  it('floors negative seconds', () => {
    expect(unixSecondsFloor(-1_500_000_000n)).toBe(-2n)
    expect(unixSecondsFloor(1_500_000_000n)).toBe(1n)
    expect(unixSecondsFloor(-2_000_000_000n)).toBe(-2n)
  })
})

describe('relative time', () => {
  const now = Date.parse('2024-03-10T14:00:00Z')
  it('chooses units with moment-like thresholds', () => {
    expect(relativeParts(44_000)).toEqual({ value: 44, unit: 'second' })
    expect(relativeParts(45_000)).toEqual({ value: 1, unit: 'minute' })
    expect(relativeParts(-3 * 3600_000)).toEqual({ value: -3, unit: 'hour' })
    expect(relativeParts(22 * 3600_000)).toEqual({ value: 1, unit: 'day' })
    expect(relativeParts(25 * 86400_000)).toEqual({ value: 25, unit: 'day' })
    expect(relativeParts(26 * 86400_000)).toEqual({ value: 1, unit: 'month' })
    expect(relativeParts(400 * 86400_000)).toEqual({ value: 1, unit: 'year' })
  })
  it('formats with Intl', () => {
    expect(formatRelative(now - 3 * 86400_000, now)).toBe('3 days ago')
    expect(formatRelative(now + 2 * 3600_000, now)).toBe('in 2 hours')
    expect(formatRelative(now, now)).toBe('now')
    expect(formatRelative(now + 2 * 3600_000, now, 'de')).toBe('in 2 Stunden')
    expect(formatRelativePrecise(now - (2 * 86400 + 4 * 3600 + 180) * 1000, now)).toBe('2 d 4 h 3 m ago')
    expect(formatRelativePrecise(now + 45_000, now)).toBe('in 45 s')
    expect(formatRelativePrecise(now, now)).toBe('now')
  })
})

describe('calendar facts', () => {
  it('ISO week boundaries', () => {
    expect(calendarFacts(BigInt(Date.parse('2024-12-30T12:00Z')) * 1_000_000n, 'UTC').isoWeekDate).toBe('2025-W01-1')
    expect(calendarFacts(BigInt(Date.parse('2021-01-03T12:00Z')) * 1_000_000n, 'UTC').isoWeekDate).toBe('2020-W53-7')
    expect(calendarFacts(S, 'UTC').isoWeekDate).toBe('2024-W10-7')
  })
  it('leap years and day of year', () => {
    const f = calendarFacts(BigInt(Date.parse('2024-12-31T12:00Z')) * 1_000_000n, 'UTC')
    expect([f.dayOfYear, f.daysInYear, f.leapYear, f.quarter, f.dayOfWeek]).toEqual([366, 366, true, 4, 'Tuesday'])
    expect(calendarFacts(BigInt(Date.parse('1900-06-01T00:00Z')) * 1_000_000n, 'UTC').leapYear).toBe(false)
    expect(calendarFacts(BigInt(Date.parse('2000-06-01T00:00Z')) * 1_000_000n, 'UTC').leapYear).toBe(true)
  })
  it('depends on the zone (date differs across the date line)', () => {
    // 2024-03-10T14:00Z is already Monday in Auckland.
    expect(calendarFacts(S, 'Pacific/Auckland').dayOfWeek).toBe('Monday')
    expect(calendarFacts(S, 'America/Los_Angeles').dayOfWeek).toBe('Sunday')
  })
  it('zoned text includes abbreviation and long name', () => {
    const z = zonedText(S, 'America/New_York')
    expect(z).toMatchObject({ wall: '2024-03-10 10:00:00', abbreviation: 'EDT', longName: 'Eastern Daylight Time', offset: '-04:00' })
  })
})

describe('Intl presets', () => {
  it('formats date and time styles per locale and zone', () => {
    const ms = Number(S / 1_000_000n)
    const en = intlPresets(ms, 'America/New_York', 'en-US')
    expect(en.find((p) => p.label === 'Date · full')?.value).toBe('Sunday, March 10, 2024')
    expect(en.find((p) => p.label === 'Date · short')?.value).toBe('3/10/24')
    expect(en.find((p) => p.label === 'Time · short')?.value).toMatch(/^10:00\sAM$/)
    const de = intlPresets(ms, 'Europe/Berlin', 'de-DE')
    expect(de.find((p) => p.label === 'Date · full')?.value).toBe('Sonntag, 10. März 2024')
    expect(de).toHaveLength(11)
  })
  it('falls back for invalid locales', () => {
    expect(intlFormat(0, 'UTC', 'not a locale!!', { year: 'numeric' })).toBe('1970')
    expect(resolvedLocale('en-GB')).toBe('en-GB')
    expect(resolvedLocale('!!')).toBe('en-US')
  })
})
