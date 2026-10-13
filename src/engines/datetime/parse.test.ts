import { describe, expect, it } from 'vitest'
import { detectUnit, MAX_EPOCH_NS, numberToEpochNs, parseDateInput, parseObsoleteHttpDate, parseRfc2822, type ParsedInput } from './parse'

const NY = 'America/New_York'
const ok = (r: ReturnType<typeof parseDateInput>): ParsedInput => {
  if (!r.ok) throw new Error(r.message)
  return r
}
const iso = (ns: bigint) => new Date(Number(ns / 1_000_000n)).toISOString()

describe('unit detection boundaries', () => {
  it('uses magnitude thresholds 1e11 / 1e14 / 1e17', () => {
    expect(detectUnit(0n)).toBe('s')
    expect(detectUnit(99_999_999_999n)).toBe('s')
    expect(detectUnit(100_000_000_000n)).toBe('ms')
    expect(detectUnit(99_999_999_999_999n)).toBe('ms')
    expect(detectUnit(100_000_000_000_000n)).toBe('us')
    expect(detectUnit(99_999_999_999_999_999n)).toBe('us')
    expect(detectUnit(100_000_000_000_000_000n)).toBe('ns')
    expect(detectUnit(-1_710_079_200_000n)).toBe('ms')
  })

  it('converts decimals exactly with bigint math', () => {
    expect(numberToEpochNs('1710079200.123456789', 's')).toEqual({ epochNs: 1_710_079_200_123_456_789n, truncatedDigits: false })
    expect(numberToEpochNs('1.5', 'ms')).toEqual({ epochNs: 1_500_000n, truncatedDigits: false })
    expect(numberToEpochNs('-1.5', 's')).toEqual({ epochNs: -1_500_000_000n, truncatedDigits: false })
    expect(numberToEpochNs('1.0000000001', 's')?.truncatedDigits).toBe(true)
    expect(numberToEpochNs('abc', 's')).toBeNull()
  })
})

describe('numeric input', () => {
  it('auto-detects each unit', () => {
    const s = ok(parseDateInput('1710079200', { zone: NY }))
    expect([s.kind, s.unit, s.label]).toEqual(['unix', 's', 'Unix seconds'])
    expect(iso(s.epochNs)).toBe('2024-03-10T14:00:00.000Z')
    expect(ok(parseDateInput('1710079200123', { zone: NY })).unit).toBe('ms')
    const us = ok(parseDateInput('1710079200123456', { zone: NY }))
    expect([us.unit, us.epochNs]).toEqual(['us', 1_710_079_200_123_456_000n])
    const ns = ok(parseDateInput('1710079200123456789', { zone: NY }))
    expect([ns.unit, ns.epochNs]).toEqual(['ns', 1_710_079_200_123_456_789n])
  })

  it('honours a forced unit and says what auto-detection would pick', () => {
    const r = ok(parseDateInput('1710079200', { zone: NY, unit: 'ms' }))
    expect(r.unit).toBe('ms')
    expect(r.autoUnit).toBe('s')
    expect(iso(r.epochNs)).toBe('1970-01-20T19:01:19.200Z')
    expect(r.note).toMatch(/forced/)
  })

  it('accepts negatives, fractions and digit separators', () => {
    expect(iso(ok(parseDateInput('-86400', { zone: NY })).epochNs)).toBe('1969-12-31T00:00:00.000Z')
    expect(ok(parseDateInput('1710079200.5', { zone: NY })).epochNs).toBe(1_710_079_200_500_000_000n)
    expect(ok(parseDateInput('1_710_079_200', { zone: NY })).epochNs).toBe(1_710_079_200_000_000_000n)
  })

  it('rejects out-of-range values explicitly', () => {
    const r = parseDateInput('9000000000000000000000', { zone: NY })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/Out of range/)
    expect(parseDateInput('8640000000001', { zone: NY, unit: 's' }).ok).toBe(false)
    expect(ok(parseDateInput('8640000000000000', { zone: NY, unit: 'ms' })).epochNs).toBe(MAX_EPOCH_NS)
    expect(ok(parseDateInput('8640000000000000', { zone: NY })).unit).toBe('us')
    expect(parseDateInput('1e9', { zone: NY }).ok).toBe(false)
  })
})

describe('ISO 8601', () => {
  it('parses UTC and explicit offsets', () => {
    const z = ok(parseDateInput('2024-03-10T14:30:00Z', { zone: NY }))
    expect([z.kind, z.offset]).toEqual(['iso-instant', 'Z'])
    expect(iso(z.epochNs)).toBe('2024-03-10T14:30:00.000Z')
    const off = ok(parseDateInput('2024-03-10T14:30:00+05:30', { zone: NY }))
    expect(off.label).toBe('ISO 8601 with offset')
    expect(iso(off.epochNs)).toBe('2024-03-10T09:00:00.000Z')
    expect(iso(ok(parseDateInput('2024-03-10 14:30:00Z', { zone: NY })).epochNs)).toBe('2024-03-10T14:30:00.000Z')
    expect(iso(ok(parseDateInput('20240310T143000Z', { zone: NY })).epochNs)).toBe('2024-03-10T14:30:00.000Z')
    expect(ok(parseDateInput('2024-03-10T14:30:00.123456789Z', { zone: NY })).epochNs % 1_000_000_000n).toBe(123_456_789n)
  })

  it('interprets offset-less input in the chosen zone and says so', () => {
    const r = ok(parseDateInput('2024-07-01T09:00', { zone: NY }))
    expect(r.kind).toBe('iso-local')
    expect(r.note).toContain('America/New_York')
    expect(iso(r.epochNs)).toBe('2024-07-01T13:00:00.000Z')
    const d = ok(parseDateInput('2024-07-01', { zone: 'Asia/Tokyo' }))
    expect(d.kind).toBe('iso-date')
    expect(iso(d.epochNs)).toBe('2024-06-30T15:00:00.000Z')
  })

  it('flags wall times skipped or repeated by DST', () => {
    const gap = ok(parseDateInput('2024-03-10T02:30', { zone: NY }))
    expect(gap.warnings[0]).toMatch(/doesn’t exist/)
    expect(iso(gap.epochNs)).toBe('2024-03-10T07:30:00.000Z') // 03:30 EDT
    const amb = ok(parseDateInput('2024-11-03T01:30', { zone: NY }))
    expect(amb.warnings[0]).toMatch(/happens twice/)
    expect(iso(amb.epochNs)).toBe('2024-11-03T05:30:00.000Z') // first (EDT)
    expect(iso(ok(parseDateInput('2024-11-03T01:30', { zone: NY, disambiguation: 'later' })).epochNs)).toBe('2024-11-03T06:30:00.000Z')
  })

  it('reads RFC 9557 zone annotations', () => {
    const r = ok(parseDateInput('2024-03-10T14:30:00[Europe/Paris]', { zone: NY }))
    expect([r.kind, r.zone]).toEqual(['iso-zoned', 'Europe/Paris'])
    expect(iso(r.epochNs)).toBe('2024-03-10T13:30:00.000Z')
    expect(parseDateInput('2024-07-01T12:00+01:00[America/New_York]', { zone: NY }).ok).toBe(false)
  })

  it('reports invalid ISO dates', () => {
    const r = parseDateInput('2024-02-30T00:00Z', { zone: NY })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toBe('February 2024 has 29 days — day 30 doesn’t exist.')
    const m = parseDateInput('2024-13-01', { zone: NY })
    expect(!m.ok && m.message).toMatch(/Month 13/)
    expect(parseDateInput('2023-02-29', { zone: NY }).ok).toBe(false)
    expect(parseDateInput('2024-02-29', { zone: NY }).ok).toBe(true)
    const h = parseDateInput('2024-01-01T25:00', { zone: NY })
    expect(!h.ok && h.message).toMatch(/Hour 25/)
    const off = parseDateInput('2024-01-01T10:00+25:00', { zone: NY })
    expect(!off.ok && off.message).toMatch(/offset out of range/)
    const bad = parseDateInput('2024-01-01T10:00:00Zjunk', { zone: NY })
    expect(!bad.ok && bad.message).toMatch(/^Looks like ISO 8601 but isn’t valid: .+[^.]\.$/)
    expect(parseDateInput('-999999-01-01T00:00', { zone: NY }).ok).toBe(false)
  })
})

describe('RFC 2822 and HTTP dates', () => {
  it('parses RFC 2822 with numeric and obsolete zones', () => {
    const r = ok(parseDateInput('Sun, 10 Mar 2024 14:30:00 +0000', { zone: NY }))
    expect(r.kind).toBe('rfc2822')
    expect(iso(r.epochNs)).toBe('2024-03-10T14:30:00.000Z')
    expect(iso(ok(parseDateInput('10 Mar 2024 09:30 EST', { zone: NY })).epochNs)).toBe('2024-03-10T14:30:00.000Z')
    expect(iso(ok(parseDateInput('Sun, 10 Mar 2024 14:30:00 +0000 (UTC)', { zone: NY })).epochNs)).toBe('2024-03-10T14:30:00.000Z')
  })

  it('warns about mismatched weekday, -0000, two-digit years', () => {
    expect(ok(parseDateInput('Mon, 10 Mar 2024 14:30:00 +0000', { zone: NY })).warnings[0]).toMatch(/Sunday/)
    expect(ok(parseDateInput('10 Mar 2024 14:30:00 -0000', { zone: NY })).warnings[0]).toMatch(/unknown/)
    const two = parseRfc2822('10 Mar 24 14:30 GMT')
    expect(typeof two === 'object' && two && two.warnings[0]).toMatch(/2024/)
    expect(parseRfc2822('10 Foo 2024 14:30 GMT')).toMatch(/month/)
    expect(parseRfc2822('10 Mar 2024 14:30 XYZ')).toMatch(/zone/)
  })

  it('recognizes HTTP IMF-fixdate, RFC 850 and asctime', () => {
    const imf = ok(parseDateInput('Sun, 06 Nov 1994 08:49:37 GMT', { zone: NY }))
    expect(imf.kind).toBe('http-date')
    expect(imf.epochNs).toBe(784_111_777_000_000_000n)
    const now = Date.parse('2024-01-01T00:00:00Z')
    const r850 = parseObsoleteHttpDate('Sunday, 06-Nov-94 08:49:37 GMT', now)
    expect(typeof r850 === 'object' && r850?.epochNs).toBe(784_111_777_000_000_000n)
    const asc = ok(parseDateInput('Sun Nov  6 08:49:37 1994', { zone: NY, nowMs: now }))
    expect([asc.kind, asc.epochNs]).toEqual(['http-date', 784_111_777_000_000_000n])
  })
})

describe('browser fallback and errors', () => {
  it('labels Date-parsed strings as ambiguous', () => {
    const r = ok(parseDateInput('March 10, 2024 14:30 UTC', { zone: NY }))
    expect(r.kind).toBe('browser')
    expect(r.warnings[0]).toMatch(/may be ambiguous/)
    expect(iso(r.epochNs)).toBe('2024-03-10T14:30:00.000Z')
    expect(parseDateInput('March 10, 2024 14:30 UTC', { zone: NY, allowBrowser: false }).ok).toBe(false)
  })
  it('rejects empty and unrecognized input', () => {
    expect(parseDateInput('   ', { zone: NY }).ok).toBe(false)
    const r = parseDateInput('not a date', { zone: NY })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/Unrecognized/)
  })
  it('handles a large batch quickly', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => String(1_700_000_000 + i * 3600))
    const t = performance.now()
    const all = lines.map((l) => parseDateInput(l, { zone: 'UTC' }))
    expect(all.every((r) => r.ok)).toBe(true)
    expect(performance.now() - t).toBeLessThan(2000)
  })
})
