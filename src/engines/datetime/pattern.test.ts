import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { formatStrftime, formatTokens, ordinalEn, STRFTIME_DOCS, TOKEN_DOCS, tokenizePattern, tokenizeStrftime } from './pattern'

// Reference instant used in the docs: Tuesday 2024-03-05 09:07:03.045 in Asia/Kolkata.
const REF = Temporal.ZonedDateTime.from('2024-03-05T09:07:03.045[Asia/Kolkata]')
const z = (s: string) => Temporal.ZonedDateTime.from(s)

describe('token patterns', () => {
  it('every documented token produces its documented example', () => {
    for (const doc of TOKEN_DOCS) {
      const pattern = doc.token === '[text]' ? '[text]' : doc.token
      expect(formatTokens(REF, pattern).output, doc.token).toBe(doc.example)
    }
  })

  it('combines tokens with literals and escapes', () => {
    expect(formatTokens(REF, 'YYYY-MM-DD HH:mm:ss').output).toBe('2024-03-05 09:07:03')
    expect(formatTokens(REF, 'YYYY-MM-DD[T]HH:mm:ss.SSSZ').output).toBe('2024-03-05T09:07:03.045+05:30')
    expect(formatTokens(REF, '[Today is] dddd, MMMM Do').output).toBe('Today is Tuesday, March 5th')
    expect(formatTokens(REF, 'GGGG-[W]WW-E').output).toBe('2024-W10-2')
    expect(formatTokens(REF, '[Q]Q YYYY').output).toBe('Q1 2024')
  })

  it('12-hour clock edges', () => {
    expect(formatTokens(z('2024-03-05T00:05[UTC]'), 'h:mm A').output).toBe('12:05 AM')
    expect(formatTokens(z('2024-03-05T12:05[UTC]'), 'hh:mm a').output).toBe('12:05 pm')
    expect(formatTokens(z('2024-03-05T23:59[UTC]'), 'h A').output).toBe('11 PM')
  })

  it('locale names come from Intl', () => {
    expect(formatTokens(REF, 'dddd D MMMM', 'de-DE').output).toBe('Dienstag 5 März')
    expect(formatTokens(REF, 'dddd', 'fr-FR').output).toBe('mardi')
    expect(formatTokens(REF, 'MMMM', 'ja-JP').output).toBe('3月')
  })

  it('English ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31, 101, 111].map(ordinalEn)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st', '101st', '111th'])
  })

  it('pads small years and floors negative unix values', () => {
    expect(formatTokens(z('0099-01-01T00:00[UTC]'), 'YYYY').output).toBe('0099')
    expect(formatTokens(Temporal.Instant.fromEpochMilliseconds(-1500).toZonedDateTimeISO('UTC'), 'X x').output).toBe('-2 -1500')
  })

  it('zone tokens', () => {
    const ny = z('2024-07-01T12:00[America/New_York]')
    expect(formatTokens(ny, 'Z ZZ z VV').output).toBe('-04:00 -0400 EDT America/New_York')
    expect(formatTokens(ny, 'zzzz').output).toBe('Eastern Daylight Time')
  })

  it('warns about an unclosed escape', () => {
    expect(formatTokens(REF, '[oops YYYY').warnings).toHaveLength(1)
    expect(formatTokens(REF, '[ok] YYYY').warnings).toHaveLength(0)
  })

  it('tokenizes for highlighting', () => {
    expect(tokenizePattern('YYYY-[W]WW')).toEqual([
      { text: 'YYYY', kind: 'token' },
      { text: '-', kind: 'literal' },
      { text: '[W]', kind: 'escape' },
      { text: 'WW', kind: 'token' },
    ])
  })
})

describe('strftime', () => {
  it('every documented directive produces its documented example', () => {
    for (const doc of STRFTIME_DOCS) expect(formatStrftime(REF, doc.token).output, doc.token).toBe(doc.example)
  })

  it('flags: no padding, space padding, uppercase', () => {
    expect(formatStrftime(REF, '%-d/%-m %_m %^a %^B').output).toBe('5/3  3 TUE MARCH')
    expect(formatStrftime(REF, '%-H:%M').output).toBe('9:07')
    expect(formatStrftime(REF, '%-F').output).toBe('2024-3-5')
  })

  it('composites and literals', () => {
    expect(formatStrftime(REF, '%F %T %z %%').output).toBe('2024-03-05 09:07:03 +0530 %')
    expect(formatStrftime(REF, '%Y-%m-%dT%H:%M:%S%:z').output).toBe('2024-03-05T09:07:03+05:30')
    expect(formatStrftime(REF, 'a%nb%tc').output).toBe('a\nb\tc')
  })

  it('week numbers %U / %W / %V match C semantics', () => {
    // 2024-01-01 is a Monday: %U (Sunday weeks) = 00, %W (Monday weeks) = 01, ISO week 01.
    expect(formatStrftime(z('2024-01-01T00:00[UTC]'), '%U %W %V').output).toBe('00 01 01')
    expect(formatStrftime(z('2024-01-07T00:00[UTC]'), '%U %W %V').output).toBe('01 01 01')
    // 2021-01-03 (Sunday): ISO week 53 of 2020.
    expect(formatStrftime(z('2021-01-03T00:00[UTC]'), '%U %W %V %G').output).toBe('01 00 53 2020')
  })

  it('reports unknown directives and keeps them literally', () => {
    const r = formatStrftime(REF, '%Q %Y %Q')
    expect(r.output).toBe('%Q 2024 %Q')
    expect(r.warnings).toEqual(['Unknown directive %Q — kept as text.'])
    expect(formatStrftime(REF, '100%').warnings[0]).toMatch(/Trailing/)
  })

  it('tokenizes directives', () => {
    expect(tokenizeStrftime('%Y-%-m')).toEqual([
      { text: '%Y', kind: 'token' },
      { text: '-', kind: 'literal' },
      { text: '%-m', kind: 'token' },
    ])
  })

  it('formats a long pattern quickly', () => {
    const pattern = '%Y-%m-%d %H:%M:%S %a %b %j %V '.repeat(2000)
    const t = performance.now()
    expect(formatStrftime(REF, pattern).output.length).toBeGreaterThan(50_000)
    expect(performance.now() - t).toBeLessThan(1500)
  })
})
