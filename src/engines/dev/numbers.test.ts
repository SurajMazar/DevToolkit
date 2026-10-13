import { describe, expect, it } from 'vitest'
import {
  approxNumber,
  bestUnit,
  convert,
  convertAll,
  formatRational,
  formatSeconds,
  parseDecimal,
  rateById,
  rational,
  SIZE_UNITS,
  toBits,
  transferSeconds,
  unitById,
} from './data-size'
import { bitLength, byteLength, formatInteger, groupDigits, interpretPattern, parseInteger, signedBitLength, twosComplement } from './base-convert'

const u = (id: string) => unitById.get(id)!
const exact = { precision: 'exact' as const }

describe('data size: units', () => {
  it('has correct decimal and binary sizes', () => {
    expect(u('kB').bits).toBe(8000n)
    expect(u('KiB').bits).toBe(8192n)
    expect(u('PB').bits).toBe(8n * 10n ** 15n)
    expect(u('PiB').bits).toBe(8n * 2n ** 50n)
    expect(u('Mbit').symbol).toBe('Mb')
    expect(u('Kibit').bits).toBe(1024n)
    expect(new Set(SIZE_UNITS.map((x) => x.symbol)).size).toBe(SIZE_UNITS.length)
  })
})

describe('data size: parsing', () => {
  it('parses decimals, separators and exponents exactly', () => {
    expect(parseDecimal('1.5')).toEqual({ ok: true, value: rational(3n, 2n) })
    expect(parseDecimal('1_000')).toEqual({ ok: true, value: rational(1000n) })
    expect(parseDecimal('2,048')).toEqual({ ok: true, value: rational(2048n) })
    expect(parseDecimal('6.02e3')).toEqual({ ok: true, value: rational(6020n) })
    expect(parseDecimal('5E-3')).toEqual({ ok: true, value: rational(1n, 200n) })
    expect(parseDecimal('.5')).toEqual({ ok: true, value: rational(1n, 2n) })
  })
  it('rejects invalid input', () => {
    expect(parseDecimal('').ok).toBe(false)
    expect(parseDecimal('abc').ok).toBe(false)
    expect(parseDecimal('1.2.3').ok).toBe(false)
    expect(parseDecimal('-1')).toEqual({ ok: false, error: 'Sizes cannot be negative' })
  })
})

describe('data size: conversion', () => {
  it('converts the GB vs GiB classic exactly', () => {
    const tb = rational(1n)
    expect(formatRational(convert(tb, u('TB'), u('GiB')), { precision: 2 }).text).toBe('931.32')
    expect(formatRational(convert(tb, u('TB'), u('B')), { precision: 0, group: true }).text).toBe('1,000,000,000,000')
  })
  it('keeps large integers exact (no float drift)', () => {
    const r = convert(rational(123456789n), u('PiB'), u('B'))
    expect(formatRational(r, exact).text).toBe((123456789n * 2n ** 50n).toString())
    expect(formatRational(convert(rational(1n), u('EiB'), u('bit')), exact).text).toBe('9223372036854775808')
  })
  it('produces exact terminating decimals', () => {
    const r = convert(rational(1n), u('bit'), u('PiB'))
    const f = formatRational(r, exact)
    expect(f.exact).toBe(true)
    expect(f.text).toBe('0.00000000000000011102230246251565404236316680908203125')
  })
  it('rounds half up at the requested precision', () => {
    expect(formatRational(rational(2n, 3n), { precision: 3 })).toEqual({ text: '0.667', exact: false })
    expect(formatRational(rational(999995n, 1000000n), { precision: 5 }).text).toBe('1')
    expect(formatRational(rational(999995n, 1000000n), { precision: 5, fixed: true }).text).toBe('1.00000')
    expect(formatRational(rational(1n, 8n), { precision: 2 }).text).toBe('0.13')
    expect(formatRational(rational(0n), { precision: 2 })).toEqual({ text: '0', exact: true })
  })
  it('converts to all units', () => {
    const rows = convertAll(rational(1n), u('GiB'), { precision: 3 })
    expect(rows.find((r) => r.unit.id === 'MiB')!.formatted.text).toBe('1024')
    expect(rows.find((r) => r.unit.id === 'MB')!.formatted.text).toBe('1073.742')
    expect(rows.find((r) => r.unit.id === 'Gbit')!.formatted.text).toBe('8.59')
  })
  it('picks a best-fit unit', () => {
    expect(bestUnit(toBits(rational(1536n), u('B')), 'byte-iec').id).toBe('KiB')
    expect(bestUnit(toBits(rational(999n), u('B')), 'byte-si').id).toBe('B')
  })
  it('approximates huge rationals as floats', () => {
    expect(approxNumber(rational(10n ** 400n, 10n ** 398n))).toBeCloseTo(100)
  })
})

describe('data size: transfer time', () => {
  it('computes time for a bandwidth', () => {
    // 1 GB at 100 Mbit/s = 80 s.
    const s = transferSeconds(toBits(rational(1n), u('GB')), rational(100n), rateById.get('Mbps')!)!
    expect(formatRational(s, exact).text).toBe('80')
    // With 80% efficiency: 100 s.
    expect(formatRational(transferSeconds(toBits(rational(1n), u('GB')), rational(100n), rateById.get('Mbps')!, rational(4n, 5n))!, exact).text).toBe('100')
    expect(transferSeconds(rational(1n), rational(0n), rateById.get('bps')!)).toBeNull()
  })
  it('formats durations', () => {
    expect(formatSeconds(80)).toBe('1 min 20 s')
    expect(formatSeconds(0.25)).toBe('250 ms')
    expect(formatSeconds(90061)).toBe('1 d 1 h 1 min')
    expect(formatSeconds(5.5)).toBe('5.5 s')
  })
})

describe('base conversion: parsing', () => {
  it('parses all common bases with prefixes and separators', () => {
    expect(parseInteger('0xDEAD_BEEF', 16)).toEqual({ ok: true, value: 0xdeadbeefn })
    expect(parseInteger('0b1010 1010', 2)).toEqual({ ok: true, value: 0xaan })
    expect(parseInteger('0o777', 8)).toEqual({ ok: true, value: 511n })
    expect(parseInteger("1'000'000", 10)).toEqual({ ok: true, value: 1000000n })
    expect(parseInteger('zz', 36)).toEqual({ ok: true, value: 1295n })
    expect(parseInteger('  -42 ', 10)).toEqual({ ok: true, value: -42n })
    // "0b1" in hex is the number 0xB1, not a binary prefix.
    expect(parseInteger('0b1', 16)).toEqual({ ok: true, value: 0xb1n })
  })
  it('reports invalid digits with their position', () => {
    expect(parseInteger('1012', 2)).toEqual({ ok: false, error: { message: expect.stringContaining('“2” is not a valid digit in base 2 (binary)'), position: 4 } })
    expect(parseInteger('12g4', 16)).toMatchObject({ ok: false, error: { position: 3 } })
    expect(parseInteger('1.5', 10)).toMatchObject({ ok: false, error: { message: expect.stringContaining('“.” is not a digit'), position: 2 } })
    expect(parseInteger('0x1F', 10)).toMatchObject({ ok: false, error: { message: expect.stringContaining('means hexadecimal'), position: 2 } })
    expect(parseInteger('', 10).ok).toBe(false)
    expect(parseInteger('-', 10).ok).toBe(false)
    expect(parseInteger('1', 37).ok).toBe(false)
  })
  it('handles huge numbers exactly in any base', () => {
    const big = 2n ** 521n - 1n
    for (const base of [2, 3, 7, 8, 10, 16, 31, 36]) {
      const s = formatInteger(big, base)
      expect(parseInteger(s, base)).toEqual({ ok: true, value: big })
    }
    const huge = '9'.repeat(5000)
    const r = parseInteger(huge, 10)
    expect(r.ok && formatInteger(r.value, 10)).toBe(huge)
  })
})

describe('base conversion: formatting', () => {
  it('groups, prefixes, uppercases and handles negatives', () => {
    expect(formatInteger(0xdeadbeefn, 16, { uppercase: true, group: 4, prefix: true })).toBe('0xDEAD BEEF')
    expect(formatInteger(-255n, 2, { group: 4, separator: '_', prefix: true })).toBe('-0b1111_1111')
    expect(formatInteger(1234567n, 10, { group: 3, separator: ',' })).toBe('1,234,567')
    expect(formatInteger(5n, 2, { minDigits: 8 })).toBe('00000101')
    expect(groupDigits('12345', 2, ' ')).toBe('1 23 45')
  })
  it('computes bit and byte lengths', () => {
    expect(bitLength(0n)).toBe(0)
    expect(bitLength(255n)).toBe(8)
    expect(bitLength(-256n)).toBe(9)
    expect(byteLength(256n)).toBe(2)
    expect(signedBitLength(127n)).toBe(8)
    expect(signedBitLength(128n)).toBe(9)
    expect(signedBitLength(-128n)).toBe(8)
    expect(signedBitLength(-129n)).toBe(9)
  })
})

describe("two's complement", () => {
  it('represents negatives', () => {
    const t = twosComplement(-1n, 8)
    expect(t).toMatchObject({ pattern: 255n, fitsSigned: true, fitsUnsigned: false, overflow: false, binary: '1111 1111', hex: 'FF' })
    expect(twosComplement(-128n, 8)).toMatchObject({ pattern: 128n, fitsSigned: true })
    expect(twosComplement(-2n, 16).hex).toBe('FFFE')
    expect(twosComplement(-1n, 128).hex).toBe('FFFF FFFF FFFF FFFF FFFF FFFF FFFF FFFF')
  })
  it('detects overflow', () => {
    expect(twosComplement(200n, 8)).toMatchObject({ fitsSigned: false, fitsUnsigned: true, overflow: false })
    expect(twosComplement(256n, 8)).toMatchObject({ overflow: true, pattern: 0n })
    expect(twosComplement(-129n, 8)).toMatchObject({ overflow: true, pattern: 127n })
    expect(twosComplement(2n ** 64n, 64).overflow).toBe(true)
  })
  it('interprets bit patterns as signed and unsigned', () => {
    expect(interpretPattern(0xffn, 8)).toEqual({ ok: true, value: { bits: 8, signed: -1n, unsigned: 255n } })
    expect(interpretPattern(0x8000_0000n, 32)).toEqual({ ok: true, value: { bits: 32, signed: -2147483648n, unsigned: 2147483648n } })
    expect(interpretPattern(0x1ffn, 8).ok).toBe(false)
    expect(interpretPattern(-1n, 8).ok).toBe(false)
  })
})
