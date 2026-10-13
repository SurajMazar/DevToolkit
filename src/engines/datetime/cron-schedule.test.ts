import { describe, expect, it } from 'vitest'
import { CronExpressionParser } from 'cron-parser'
import { parseCron, type CronDialect } from './cron'
import { nextRuns, type DstPolicy } from './cron-schedule'

const NY = 'America/New_York'

function runs(expr: string, dialect: CronDialect, from: string, zone: string, count = 5, policy?: DstPolicy) {
  const p = parseCron(expr, dialect)
  if (!p.ok) throw new Error(p.errors[0].message)
  return nextRuns(p.cron, { fromMs: Date.parse(from), zone, count, policy })
}
const walls = (r: ReturnType<typeof runs>) => r.runs.map((x) => `${x.wall} ${x.offset}`)

describe('agrees with cron-parser where semantics match (UTC and fixed zones)', () => {
  const unix = ['*/5 * * * *', '0 9 * * 1-5', '30 2 1,15 * *', '0 0 1 * 1', '0 0 29 2 *', '15 14 1 * *', '0 22 * * 1-5', '23 0-20/2 * * *', '5 4 * * sun', '0 0,12 1 */2 *', '0 0 * * 7', '0 12 1-7 * *']
  const seconds = ['*/15 * * * * *', '0 30 9 * * 1-5', '10 0 0 1 1 *', '0 0 */3 * * *']
  const from = '2024-01-15T10:07:30Z'
  for (const zone of ['UTC', 'Asia/Tokyo', 'Asia/Kathmandu']) {
    for (const expr of unix) {
      it(`unix ${expr} in ${zone}`, () => {
        const ours = runs(expr, 'unix', from, zone, 25).runs.map((r) => r.epochMs)
        const ref = CronExpressionParser.parse(expr, { currentDate: from, tz: zone }).take(25).map((d) => d.getTime())
        expect(ours).toEqual(ref)
      })
    }
    for (const expr of seconds) {
      it(`seconds ${expr} in ${zone}`, () => {
        const ours = runs(expr, 'seconds', from, zone, 25).runs.map((r) => r.epochMs)
        const ref = CronExpressionParser.parse(expr, { currentDate: from, tz: zone }).take(25).map((d) => d.getTime())
        expect(ours).toEqual(ref)
      })
    }
  }
  it('quartz specials agree with cron-parser equivalents', () => {
    const pairs: [string, string][] = [
      ['0 15 10 ? * 6L', '0 15 10 * * 5L'],
      ['0 0 12 ? * MON#2', '0 0 12 * * 1#2'],
      ['0 0 0 L * ?', '0 0 0 L * *'],
    ]
    for (const [q, cp] of pairs) {
      const ours = runs(q, 'quartz', from, 'UTC', 12).runs.map((r) => r.epochMs)
      const ref = CronExpressionParser.parse(cp, { currentDate: from, tz: 'UTC' }).take(12).map((d) => d.getTime())
      expect(ours, q).toEqual(ref)
    }
  })
})

describe('Unix (Vixie) DST behaviour — America/New_York', () => {
  it('fixed job in the spring-forward gap runs right after the jump', () => {
    const r = runs('30 2 * * *', 'unix', '2024-03-08T12:00:00Z', NY, 3)
    expect(walls(r)).toEqual(['2024-03-09 02:30:00 -05:00', '2024-03-10 03:00:00 -04:00', '2024-03-11 02:30:00 -04:00'])
    expect(r.runs[1].note?.kind).toBe('gap-jump')
  })
  it('wildcard job skips the missing hour', () => {
    const r = runs('*/30 * * * *', 'unix', '2024-03-10T06:20:00Z', NY, 4)
    expect(walls(r)).toEqual(['2024-03-10 01:30:00 -05:00', '2024-03-10 03:00:00 -04:00', '2024-03-10 03:30:00 -04:00', '2024-03-10 04:00:00 -04:00'])
    expect(r.skipped.map((s) => s.wall)).toEqual(['2024-03-10 02:00:00', '2024-03-10 02:30:00'])
  })
  it('fixed job in the fall-back overlap runs once', () => {
    const r = runs('30 1 * * *', 'unix', '2024-11-02T12:00:00Z', NY, 2)
    expect(walls(r)).toEqual(['2024-11-03 01:30:00 -04:00', '2024-11-04 01:30:00 -05:00'])
    expect(r.runs[0].note?.kind).toBe('overlap-once')
  })
  it('wildcard job runs twice in the repeated hour', () => {
    const r = runs('*/30 * * * *', 'unix', '2024-11-03T04:50:00Z', NY, 5)
    expect(walls(r)).toEqual([
      '2024-11-03 01:00:00 -04:00',
      '2024-11-03 01:30:00 -04:00',
      '2024-11-03 01:00:00 -05:00',
      '2024-11-03 01:30:00 -05:00',
      '2024-11-03 02:00:00 -05:00',
    ])
    expect(r.runs[2].note?.kind).toBe('overlap-second')
  })
  it('starting inside the first pass of the overlap still finds the repeated runs', () => {
    const r = runs('*/30 * * * *', 'unix', '2024-11-03T05:15:00Z', NY, 4) // 01:15 EDT
    expect(walls(r)).toEqual(['2024-11-03 01:30:00 -04:00', '2024-11-03 01:00:00 -05:00', '2024-11-03 01:30:00 -05:00', '2024-11-03 02:00:00 -05:00'])
  })
  it('Europe/London spring-forward (01:00 → 02:00)', () => {
    const r = runs('30 1 * * *', 'unix', '2024-03-30T12:00:00Z', 'Europe/London', 2)
    expect(walls(r)).toEqual(['2024-03-31 02:00:00 +01:00', '2024-04-01 01:30:00 +01:00'])
  })
})

describe('Seconds dialect (instant matcher) DST behaviour', () => {
  it('skips a wall time that never happens', () => {
    const r = runs('0 30 2 * * *', 'seconds', '2024-03-08T12:00:00Z', NY, 3)
    expect(walls(r)).toEqual(['2024-03-09 02:30:00 -05:00', '2024-03-11 02:30:00 -04:00', '2024-03-12 02:30:00 -04:00'])
    expect(r.skipped).toEqual([{ wall: '2024-03-10 02:30:00', text: expect.stringMatching(/never occurs/) }])
  })
  it('runs a repeated wall time twice', () => {
    const r = runs('0 30 1 * * *', 'seconds', '2024-11-02T12:00:00Z', NY, 3)
    expect(walls(r)).toEqual(['2024-11-03 01:30:00 -04:00', '2024-11-03 01:30:00 -05:00', '2024-11-04 01:30:00 -05:00'])
  })
  it('from the second pass of an overlap, the first pass is in the past', () => {
    const r = runs('0 */30 * * * *', 'seconds', '2024-11-03T06:10:00Z', NY, 2) // 01:10 EST
    expect(walls(r)).toEqual(['2024-11-03 01:30:00 -05:00', '2024-11-03 02:00:00 -05:00'])
  })
})

describe('Quartz (wall clock) DST behaviour', () => {
  it('shifts a skipped time forward by the gap', () => {
    const r = runs('0 30 2 * * ?', 'quartz', '2024-03-08T12:00:00Z', NY, 3)
    expect(walls(r)).toEqual(['2024-03-09 02:30:00 -05:00', '2024-03-10 03:30:00 -04:00', '2024-03-11 02:30:00 -04:00'])
    expect(r.runs[1].note?.kind).toBe('gap-shift')
  })
  it('does not revisit the repeated hour', () => {
    const r = runs('0 0/30 * * * ?', 'quartz', '2024-11-03T04:50:00Z', NY, 4)
    expect(walls(r)).toEqual(['2024-11-03 01:00:00 -04:00', '2024-11-03 01:30:00 -04:00', '2024-11-03 02:00:00 -05:00', '2024-11-03 02:30:00 -05:00'])
  })
  it('collapses gap times onto existing ones without duplicates', () => {
    const r = runs('0 0/30 * * * ?', 'quartz', '2024-03-10T06:20:00Z', NY, 4)
    expect(walls(r)).toEqual(['2024-03-10 01:30:00 -05:00', '2024-03-10 03:00:00 -04:00', '2024-03-10 03:30:00 -04:00', '2024-03-10 04:00:00 -04:00'])
  })
  it('respects the year field and stops', () => {
    const r = runs('0 0 0 1 1 ? 2025-2026', 'quartz', '2024-06-01T00:00:00Z', 'UTC', 5)
    expect(walls(r)).toEqual(['2025-01-01 00:00:00 +00:00', '2026-01-01 00:00:00 +00:00'])
    expect(r.exhausted).toBe(true)
  })
  it('EventBridge last-weekday rules', () => {
    const r = runs('cron(0 18 ? * 6L *)', 'aws', '2024-01-01T00:00:00Z', 'UTC', 3)
    expect(walls(r)).toEqual(['2024-01-26 18:00:00 +00:00', '2024-02-23 18:00:00 +00:00', '2024-03-29 18:00:00 +00:00'])
  })
})

describe('edge cases', () => {
  it('impossible dates finish quickly with no runs', () => {
    const t = performance.now()
    const r = runs('0 0 30 2 *', 'unix', '2024-01-01T00:00:00Z', 'UTC', 5)
    expect(r.runs).toEqual([])
    expect(r.exhausted).toBe(true)
    expect(performance.now() - t).toBeLessThan(1500)
  })
  it('leap day schedules', () => {
    const r = runs('0 0 29 2 *', 'unix', '2024-03-01T00:00:00Z', 'UTC', 3)
    expect(r.runs.map((x) => x.wall.slice(0, 10))).toEqual(['2028-02-29', '2032-02-29', '2036-02-29'])
    // node-cron AND rule: Feb 29 that is also a Monday — 2044, 2072 …
    const p = parseCron('0 0 0 29 2 1', 'seconds', { dayRule: 'and' })
    const and = p.ok ? nextRuns(p.cron, { fromMs: Date.parse('2024-03-01T00:00:00Z'), zone: 'UTC', count: 2 }) : null
    expect(and?.runs.map((x) => x.wall.slice(0, 10))).toEqual(['2044-02-29', '2072-02-29'])
  })
  it('@reboot has no runs; runs are strictly after "from"', () => {
    expect(runs('@reboot', 'unix', '2024-01-01T00:00:00Z', 'UTC').runs).toEqual([])
    expect(runs('0 * * * *', 'unix', '2024-01-01T00:00:00Z', 'UTC', 1).runs[0].wall).toBe('2024-01-01 01:00:00')
    expect(runs('0 * * * *', 'unix', '2024-01-01T00:59:59.999Z', 'UTC', 1).runs[0].wall).toBe('2024-01-01 01:00:00')
  })
  it('50 every-second runs is fast', () => {
    const t = performance.now()
    const r = runs('* * * * * *', 'seconds', '2024-01-01T00:00:00Z', NY, 50)
    expect(r.runs).toHaveLength(50)
    expect(r.runs[49].epochMs - r.runs[0].epochMs).toBe(49_000)
    expect(performance.now() - t).toBeLessThan(1500)
  })
})
