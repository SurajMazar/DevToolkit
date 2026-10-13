import { describe, expect, it } from 'vitest'
import {
  analyzeFieldToken,
  buildFieldToken,
  CRON_PRESETS,
  daysInMonth,
  describeValues,
  matchingDays,
  parseCron,
  weekday,
  type CronDialect,
  type CronFieldName,
  type ParsedCron,
} from './cron'
import { describeCron } from './cron-describe'

function ok(expr: string, dialect: CronDialect, dayRule?: 'or' | 'and'): ParsedCron {
  const r = parseCron(expr, dialect, { dayRule })
  if (!r.ok) throw new Error(`${expr}: ${r.errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`)
  return r.cron
}
function err(expr: string, dialect: CronDialect): { field: CronFieldName | null; message: string } {
  const r = parseCron(expr, dialect)
  if (r.ok) throw new Error(`${expr} should be invalid in ${dialect}`)
  return r.errors[0]
}

describe('unix dialect', () => {
  it('parses standard syntax', () => {
    const c = ok('*/15 9-17 * * 1-5', 'unix')
    expect(c.fields.minute.values).toEqual([0, 15, 30, 45])
    expect(c.fields.hour.values).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(c.fields.dayOfWeek.values).toEqual([1, 2, 3, 4, 5])
    expect(c.fields.second.values).toEqual([0])
    expect(ok('0 0 * * 7', 'unix').fields.dayOfWeek.values).toEqual([0])
    expect(ok('0 0 * * 5-7', 'unix').fields.dayOfWeek.values).toEqual([0, 5, 6])
    expect(ok('0 0 1 jan,JUL *', 'unix').fields.month.values).toEqual([1, 7])
    expect(ok('0 0 * * */2', 'unix').fields.dayOfWeek.values).toEqual([0, 2, 4, 6])
    expect(ok('1-10/3 * * * *', 'unix').fields.minute.values).toEqual([1, 4, 7, 10])
  })

  it('expands macros and handles @reboot', () => {
    const d = ok('@daily', 'unix')
    expect([d.expression, d.macro]).toEqual(['0 0 * * *', '@daily'])
    expect(ok('@weekly', 'unix').fields.dayOfWeek.values).toEqual([0])
    expect(ok('@reboot', 'unix').reboot).toBe(true)
    expect(err('@sometimes', 'unix').message).toMatch(/Unknown macro/)
    expect(err('@daily', 'quartz').message).toMatch(/Unix crontab syntax/)
  })

  it('gives field-level errors', () => {
    expect(err('60 * * * *', 'unix')).toEqual({ field: 'minute', message: '60 is out of range — minute accepts 0–59.' })
    expect(err('0 24 * * *', 'unix').field).toBe('hour')
    expect(err('0 0 0 * *', 'unix').field).toBe('dayOfMonth')
    expect(err('0 0 * 13 *', 'unix').field).toBe('month')
    expect(err('0 0 * * 8', 'unix').field).toBe('dayOfWeek')
    expect(err('0 0 * * FUN', 'unix').message).toMatch(/isn’t a valid day of week/)
    expect(err('5-1 * * * *', 'unix').message).toMatch(/backwards/)
    expect(err('5/15 * * * *', 'unix').message).toMatch(/needs a range or \*/)
    expect(err('*/0 * * * *', 'unix').message).toMatch(/at least 1/)
    expect(err('0,,5 * * * *', 'unix').message).toMatch(/Empty item/)
    expect(err('0 0 L * *', 'unix')).toMatchObject({ field: 'dayOfMonth', message: expect.stringMatching(/Quartz/) })
    expect(err('0 0 * * 5#2', 'unix').message).toMatch(/“#”/)
    expect(err('0 0 ? * *', 'unix').message).toMatch(/“\?”/)
    expect(err('H * * * *', 'unix').message).toMatch(/Jenkins/)
    expect(err('0 0 * * 1.5', 'unix').field).toBe('dayOfWeek')
  })

  it('reports all invalid fields, not just the first', () => {
    const r = parseCron('99 99 * * *', 'unix')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.map((e) => e.field)).toEqual(['minute', 'hour'])
  })

  it('explains wrong field counts', () => {
    expect(err('* * * *', 'unix').message).toMatch(/found 4/)
    expect(err('0 * * * * *', 'unix').message).toMatch(/seconds/)
    expect(err('0 0 * * * /usr/bin/backup', 'unix').message).toMatch(/command/)
    expect(err('0 0 12 * * ? 2025', 'unix').message).toMatch(/Quartz/)
  })

  it('warns about portability and odd steps', () => {
    const r = parseCron('0 9 * * MON-FRI', 'unix')
    expect(r.ok && r.warnings[0].message).toMatch(/Vixie/)
    const big = parseCron('*/90 * * * *', 'unix')
    expect(big.ok && big.cron.fields.minute.values).toEqual([0])
    expect(big.ok && big.warnings[0].field).toBe('minute')
    // JUL contains an L and WED a W, but they are names, not specials.
    expect(ok('0 0 1 JUL WED', 'unix').fields.month.values).toEqual([7])
  })
})

describe('seconds dialect', () => {
  it('requires six fields and parses seconds', () => {
    expect(ok('*/15 * * * * *', 'seconds').fields.second.values).toEqual([0, 15, 30, 45])
    expect(err('* * * * *', 'seconds').message).toMatch(/Prepend a seconds value/)
    expect(err('0 0 12 * * ? 2025', 'seconds').message).toMatch(/Quartz/)
    expect(err('0 0 0 L * *', 'seconds').message).toMatch(/Quartz/)
  })
  it('day rule option', () => {
    expect(ok('0 0 0 1 * 1', 'seconds').dayRule).toBe('or')
    expect(ok('0 0 0 1 * 1', 'seconds', 'and').dayRule).toBe('and')
  })
})

describe('quartz dialect', () => {
  it('accepts 6 or 7 fields with ? in one day field', () => {
    expect(ok('0 0 12 * * ?', 'quartz').fields.dayOfWeek.noSpec).toBe(true)
    expect(ok('0 0 12 ? * MON-FRI', 'quartz').fields.dayOfWeek.values).toEqual([1, 2, 3, 4, 5])
    expect(ok('0 0 12 ? * 2-6', 'quartz').fields.dayOfWeek.values).toEqual([1, 2, 3, 4, 5]) // 1 = SUN in Quartz
    expect(ok('0 0 0 1 1 ? 2025-2027', 'quartz').fields.year.values).toEqual([2025, 2026, 2027])
    expect(ok('0 0/5 * * * ?', 'quartz').fields.minute.values).toHaveLength(12)
    expect(ok('0 10/20 * * * ?', 'quartz').fields.minute.values).toEqual([10, 30, 50])
  })

  it('requires exactly one ?', () => {
    expect(err('0 0 12 * * *', 'quartz').message).toMatch(/requires “\?”/)
    expect(err('0 0 12 ? * ?', 'quartz').message).toMatch(/both day fields/)
    expect(err('0 0 12 1 * MON', 'quartz').field).toBe('dayOfMonth')
  })

  it('specials: L, L-n, LW, nW, nL, n#k', () => {
    expect(ok('0 0 12 L * ?', 'quartz').fields.dayOfMonth.lastDayOffset).toBe(0)
    expect(ok('0 0 12 L-3 * ?', 'quartz').fields.dayOfMonth.lastDayOffset).toBe(3)
    expect(ok('0 0 12 LW * ?', 'quartz').fields.dayOfMonth.lastWeekday).toBe(true)
    expect(ok('0 0 12 15W * ?', 'quartz').fields.dayOfMonth.nearestWeekday).toBe(15)
    expect(ok('0 0 12 ? * 6L', 'quartz').fields.dayOfWeek.lastDow).toBe(5) // Friday
    expect(ok('0 0 12 ? * FRIL', 'quartz').fields.dayOfWeek.lastDow).toBe(5)
    expect(ok('0 0 12 ? * 6#3', 'quartz').fields.dayOfWeek.nthDow).toEqual({ dow: 5, n: 3 })
    expect(ok('0 0 12 ? * MON#2', 'quartz').fields.dayOfWeek.nthDow).toEqual({ dow: 1, n: 2 })
    const sat = parseCron('0 0 12 ? * L', 'quartz')
    expect(sat.ok && sat.cron.fields.dayOfWeek.values).toEqual([6])
    expect(sat.ok && sat.warnings[0].message).toMatch(/Saturday/)
  })

  it('rejects invalid specials', () => {
    expect(err('0 0 12 1,L * ?', 'quartz').message).toMatch(/can’t be combined/)
    expect(err('0 0 12 ? * 2#6', 'quartz').message).toMatch(/1–5/)
    expect(err('0 0 12 ? * 1L,2', 'quartz').message).toMatch(/can’t be combined/)
    expect(err('0 0 12 1-5W * ?', 'quartz').message).toMatch(/single day/)
    expect(err('0 0 12 L-31 * ?', 'quartz').message).toMatch(/30 or less/)
    expect(err('0 0 12 ? * 0', 'quartz').message).toMatch(/1–7/)
    expect(err('0 0/75 * * * ?', 'quartz').message).toMatch(/larger than/)
    expect(err('0 0 0 1 1 ? 1969', 'quartz').field).toBe('year')
    expect(err('0 0 0 1 1 ? 2030-2025', 'quartz').message).toMatch(/backwards/)
    expect(err('0 0 * * *', 'quartz').message).toMatch(/looks like Unix/)
  })

  it('wrap-around ranges', () => {
    expect(ok('0 0 22-2 * * ?', 'quartz').fields.hour.values).toEqual([0, 1, 2, 22, 23])
    expect(ok('0 0 0 ? * FRI-MON', 'quartz').fields.dayOfWeek.values).toEqual([0, 1, 5, 6])
    expect(ok('0 0 0 1 NOV-FEB ?', 'quartz').fields.month.values).toEqual([1, 2, 11, 12])
  })
})

describe('aws dialect', () => {
  it('accepts cron(...) wrapper and 6 fields', () => {
    const c = ok('cron(0 9 ? * MON-FRI *)', 'aws')
    expect(c.fields.minute.values).toEqual([0])
    expect(c.fields.hour.values).toEqual([9])
    expect(c.fields.second.values).toEqual([0])
    expect(ok('0/15 * * * ? *', 'aws').fields.minute.values).toEqual([0, 15, 30, 45])
    expect(ok('0 0 1 * ? 2199', 'aws').fields.year.values).toEqual([2199])
  })
  it('rejects non-EventBridge syntax', () => {
    expect(err('rate(5 minutes)', 'aws').message).toMatch(/rate\(\)/)
    expect(err('cron(0 12 * * ? *', 'aws').message).toMatch(/closing/)
    expect(err('cron(0 0 12 * * ? *)', 'aws').message).toMatch(/no seconds/)
    expect(err('cron(0 12 L-2 * ? *)', 'aws').message).toMatch(/Quartz-only/)
    expect(err('cron(0 12 * * * *)', 'aws').message).toMatch(/requires “\?”/)
    expect(err('cron(0 12 * * ?)', 'aws').message).toMatch(/year/)
  })
})

describe('matchingDays', () => {
  it('weekday and month length helpers', () => {
    expect(weekday(2024, 1, 1)).toBe(1) // Monday
    expect(weekday(2000, 2, 29)).toBe(2) // Tuesday
    expect(weekday(1970, 1, 1)).toBe(4)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2100, 2)).toBe(28)
  })
  it('Vixie OR when both day fields are restricted', () => {
    expect(matchingDays(ok('0 0 1 * 1', 'unix'), 2024, 1)).toEqual([1, 8, 15, 22, 29])
    expect(matchingDays(ok('0 0 13 * 5', 'unix'), 2024, 9)).toEqual([6, 13, 20, 27])
  })
  it('Vixie AND when a day field starts with *', () => {
    // */2 in DOW starts with '*': day 1 must ALSO be Sun/Tue/Thu/Sat.
    expect(matchingDays(ok('0 0 1 * */2', 'unix'), 2024, 1)).toEqual([]) // Jan 1 2024 is a Monday
    expect(matchingDays(ok('0 0 1 * */2', 'unix'), 2024, 2)).toEqual([1]) // Feb 1 2024 is a Thursday
    expect(matchingDays(ok('0 0 * * 1', 'unix'), 2024, 1)).toEqual([1, 8, 15, 22, 29])
  })
  it('node-cron AND rule', () => {
    expect(matchingDays(ok('0 0 0 1 * 1', 'seconds', 'and'), 2024, 1)).toEqual([1])
    expect(matchingDays(ok('0 0 0 1 * 1', 'seconds', 'or'), 2024, 1)).toEqual([1, 8, 15, 22, 29])
  })
  it('Quartz specials', () => {
    expect(matchingDays(ok('0 0 0 LW * ?', 'quartz'), 2024, 3)).toEqual([29]) // Mar 31 2024 is Sunday
    expect(matchingDays(ok('0 0 0 L * ?', 'quartz'), 2024, 2)).toEqual([29])
    expect(matchingDays(ok('0 0 0 L-2 * ?', 'quartz'), 2024, 2)).toEqual([27])
    expect(matchingDays(ok('0 0 0 15W * ?', 'quartz'), 2024, 6)).toEqual([14]) // Sat 15 → Fri 14
    expect(matchingDays(ok('0 0 0 1W * ?', 'quartz'), 2024, 6)).toEqual([3]) // Sat 1 → Mon 3
    expect(matchingDays(ok('0 0 0 30W * ?', 'quartz'), 2024, 6)).toEqual([28]) // Sun 30 (last) → Fri 28
    expect(matchingDays(ok('0 0 0 16W * ?', 'quartz'), 2024, 6)).toEqual([17]) // Sun 16 → Mon 17
    expect(matchingDays(ok('0 0 0 31W * ?', 'quartz'), 2024, 6)).toEqual([])
    expect(matchingDays(ok('0 0 0 ? * 6L', 'quartz'), 2024, 3)).toEqual([29])
    expect(matchingDays(ok('0 0 0 ? * 6#3', 'quartz'), 2024, 3)).toEqual([15])
    expect(matchingDays(ok('0 0 0 ? * 2#5', 'quartz'), 2024, 2)).toEqual([]) // no 5th Monday in Feb 2024
    expect(matchingDays(ok('0 0 0 ? * 2#5', 'quartz'), 2024, 4)).toEqual([29])
  })
})

describe('builder helpers', () => {
  it('analyzes tokens into editable models', () => {
    expect(analyzeFieldToken('*', 'unix', 'minute').mode).toBe('every')
    expect(analyzeFieldToken('*/5', 'unix', 'minute')).toMatchObject({ mode: 'step', start: 0, interval: 5 })
    expect(analyzeFieldToken('10/5', 'quartz', 'minute')).toMatchObject({ mode: 'step', start: 10, interval: 5 })
    expect(analyzeFieldToken('9-17', 'unix', 'hour')).toMatchObject({ mode: 'range', from: 9, to: 17 })
    expect(analyzeFieldToken('MON,WED,FRI', 'unix', 'dayOfWeek')).toMatchObject({ mode: 'list', list: [1, 3, 5] })
    expect(analyzeFieldToken('?', 'quartz', 'dayOfMonth').mode).toBe('nospec')
    expect(analyzeFieldToken('LW', 'quartz', 'dayOfMonth')).toMatchObject({ mode: 'special', special: 'LW' })
  })
  it('builds dialect-correct tokens', () => {
    const base = analyzeFieldToken('*', 'unix', 'minute')
    expect(buildFieldToken({ ...base, mode: 'step', start: 0, interval: 10 }, 'unix', 'minute')).toBe('*/10')
    expect(buildFieldToken({ ...base, mode: 'step', start: 5, interval: 10 }, 'unix', 'minute')).toBe('5-59/10')
    expect(buildFieldToken({ ...base, mode: 'step', start: 5, interval: 10 }, 'quartz', 'minute')).toBe('5/10')
    expect(buildFieldToken({ ...base, mode: 'list', list: [30, 0, 15] }, 'unix', 'minute')).toBe('0,15,30')
    expect(buildFieldToken({ ...base, mode: 'list', list: [] }, 'unix', 'minute')).toBe('*')
    expect(buildFieldToken({ ...base, mode: 'range', from: 1, to: 5 }, 'unix', 'dayOfWeek')).toBe('1-5')
  })
  it('every preset is valid in each dialect it lists', () => {
    for (const p of CRON_PRESETS) {
      for (const [dialect, expr] of Object.entries(p.expr)) {
        const r = parseCron(expr!, dialect as CronDialect)
        expect(r.ok, `${p.label} / ${dialect}: ${expr}`).toBe(true)
      }
    }
  })
  it('describes values compactly', () => {
    expect(describeValues(ok('0 0 * * 1-5', 'unix').fields.dayOfWeek, 'unix')).toBe('Mon–Fri')
    expect(describeValues(ok('0,15,30,45 * * * *', 'unix').fields.minute, 'unix')).toBe('0, 15, 30, 45')
    expect(describeValues(ok('0 0 * JAN,FEB,MAR,JUN *', 'unix').fields.month, 'unix')).toBe('Jan–Mar, Jun')
    expect(describeValues(ok('0 0 12 ? * 6#3', 'quartz').fields.dayOfWeek, 'quartz')).toBe('3rd Friday of the month')
    expect(describeValues(ok('* * * * *', 'unix').fields.minute, 'unix')).toBe('every minute')
  })
})

describe('describeCron (cronstrue per dialect)', () => {
  it('uses the right day numbering per dialect', () => {
    expect(describeCron(ok('0 9 * * 1-5', 'unix')).text).toBe('At 09:00, Monday through Friday')
    expect(describeCron(ok('0 0 9 ? * 2-6', 'quartz')).text).toBe('At 09:00, Monday through Friday')
    expect(describeCron(ok('cron(0 9 ? * MON-FRI *)', 'aws')).text).toBe('At 09:00, Monday through Friday')
    expect(describeCron(ok('*/15 * * * * *', 'seconds')).text).toBe('Every 15 seconds')
    expect(describeCron(ok('0 15 10 ? * 6L', 'quartz')).text).toBe('At 10:15, on the last Friday of the month')
  })
  it('adds notes the sentence leaves out', () => {
    expect(describeCron(ok('0 0 1 * 1', 'unix')).notes[0]).toMatch(/EITHER/)
    expect(describeCron(ok('0 0 1 * */2', 'unix')).notes[0]).toMatch(/BOTH/)
    expect(describeCron(ok('0 0 0 1 * 1', 'seconds', 'and')).notes[0]).toMatch(/BOTH/)
    expect(describeCron(ok('@weekly', 'unix')).notes[0]).toMatch(/shorthand/)
    expect(describeCron(ok('@reboot', 'unix')).text).toMatch(/starts/)
    expect(describeCron(ok('cron(0 9 * * ? *)', 'aws')).notes.join(' ')).toMatch(/UTC/)
  })
})
