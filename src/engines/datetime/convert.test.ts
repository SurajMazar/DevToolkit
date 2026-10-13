import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { dayDelta, dayTimeline, overlapRanges, resolveWallTime } from './convert'

const p = (s: string) => Temporal.PlainDateTime.from(s)

describe('resolveWallTime', () => {
  it('ordinary times resolve to one instant', () => {
    const r = resolveWallTime(p('2024-07-01T09:00'), 'America/New_York', 'reject')
    expect(r.status).toBe('ok')
    expect(r.chosen?.toString()).toBe('2024-07-01T09:00:00-04:00[America/New_York]')
  })

  it('spring-forward gap in New York (2024-03-10 02:30)', () => {
    const r = resolveWallTime(p('2024-03-10T02:30'), 'America/New_York', 'compatible')
    expect(r.status).toBe('gap')
    expect(r.shiftMinutes).toBe(60)
    expect(r.earlier.toString()).toBe('2024-03-10T01:30:00-05:00[America/New_York]')
    expect(r.later.toString()).toBe('2024-03-10T03:30:00-04:00[America/New_York]')
    expect(r.chosen?.toString()).toBe(r.later.toString())
    expect(r.explanation).toMatch(/jump from 02:00 to 03:00/)
    expect(resolveWallTime(p('2024-03-10T02:30'), 'America/New_York', 'earlier').chosen?.hour).toBe(1)
    expect(resolveWallTime(p('2024-03-10T02:30'), 'America/New_York', 'reject').chosen).toBeNull()
  })

  it('fall-back overlap in New York (2024-11-03 01:30)', () => {
    const r = resolveWallTime(p('2024-11-03T01:30'), 'America/New_York', 'later')
    expect(r.status).toBe('ambiguous')
    expect(r.earlier.offset).toBe('-04:00')
    expect(r.later.offset).toBe('-05:00')
    expect(r.chosen?.offset).toBe('-05:00')
    expect(r.explanation).toMatch(/EDT.*EST/)
    expect(resolveWallTime(p('2024-11-03T01:30'), 'America/New_York', 'compatible').chosen?.offset).toBe('-04:00')
  })

  it('Europe/London gap and overlap', () => {
    expect(resolveWallTime(p('2024-03-31T01:30'), 'Europe/London', 'compatible').status).toBe('gap')
    const o = resolveWallTime(p('2024-10-27T01:30'), 'Europe/London', 'earlier')
    expect(o.status).toBe('ambiguous')
    expect(o.chosen?.offset).toBe('+01:00')
  })
})

describe('day timeline', () => {
  it('normal day has 24 cells mapped into each zone', () => {
    const sel = Temporal.ZonedDateTime.from('2024-07-01T12:00[America/New_York]')
    const t = dayTimeline(sel, ['America/New_York', 'Europe/London', 'Asia/Kolkata'])
    expect(t.hours).toBe(24)
    expect(t.markerPosition).toBe(12)
    expect(t.rows[1].cells[0]).toMatchObject({ hour: 5, minute: 0, dayDelta: 0 })
    expect(t.rows[2].cells[0]).toMatchObject({ hour: 9, minute: 30, dayDelta: 0, kind: 'work' })
    expect(t.rows[2].cells[23]).toMatchObject({ hour: 8, minute: 30, dayDelta: 1 })
    // NY 09–11 = London 14–16 = Kolkata 18:30–20:30: NY 9 and 10 overlap with London only (Kolkata ends 17:00).
    expect(overlapRanges(dayTimeline(sel, ['America/New_York', 'Europe/London']).overlap)).toEqual([[9, 12]])
    expect(overlapRanges(t.overlap)).toEqual([])
  })

  it('DST days have 23 or 25 hourly cells', () => {
    expect(dayTimeline(Temporal.ZonedDateTime.from('2024-03-10T12:00[America/New_York]'), ['UTC']).hours).toBe(23)
    expect(dayTimeline(Temporal.ZonedDateTime.from('2024-11-03T12:00[America/New_York]'), ['UTC']).hours).toBe(25)
  })

  it('dayDelta across the date line', () => {
    const ref = Temporal.ZonedDateTime.from('2024-07-01T20:00[America/Los_Angeles]')
    expect(dayDelta(ref.withTimeZone('Asia/Tokyo'), ref)).toBe(1)
    expect(dayDelta(ref.withTimeZone('Pacific/Honolulu'), ref)).toBe(0)
  })

  it('overlap ranges', () => {
    expect(overlapRanges([false, true, true, false, true])).toEqual([
      [1, 3],
      [4, 5],
    ])
  })
})
