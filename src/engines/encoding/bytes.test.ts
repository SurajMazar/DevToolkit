import { describe, expect, it } from 'vitest'
import { bytesToUtf8Text, detectByteBase, formatByteNotation, parseByteNotation, textToByteNotation, type ByteBase } from './bytes'

const roundTrip = (text: string, base: ByteBase, sep: 'space' | 'none' | 'comma' | 'newline', prefix: 'none' | 'c' | 'escape' = 'none') => {
  const n = textToByteNotation(text, { base, separator: sep, prefix })
  const p = parseByteNotation(n, base)
  return bytesToUtf8Text(p).text
}

describe('formatByteNotation', () => {
  const hi = new TextEncoder().encode('Hi é')
  it('formats each base', () => {
    expect(formatByteNotation(hi, { base: 'hex', separator: 'space' })).toBe('48 69 20 c3 a9')
    expect(formatByteNotation(hi, { base: 'hex', separator: 'none', uppercase: true })).toBe('486920C3A9')
    expect(formatByteNotation(hi, { base: 'bin', separator: 'space' })).toBe('01001000 01101001 00100000 11000011 10101001')
    expect(formatByteNotation(hi, { base: 'oct', separator: 'space' })).toBe('110 151 040 303 251')
    expect(formatByteNotation(hi, { base: 'dec', separator: 'comma' })).toBe('72, 105, 32, 195, 169')
  })
  it('supports prefixes and line grouping', () => {
    expect(formatByteNotation(hi, { base: 'hex', separator: 'comma', prefix: 'c' })).toBe('0x48, 0x69, 0x20, 0xc3, 0xa9')
    expect(formatByteNotation(hi, { base: 'hex', separator: 'none', prefix: 'escape' })).toBe('\\x48\\x69\\x20\\xc3\\xa9')
    expect(formatByteNotation(hi, { base: 'hex', separator: 'space', bytesPerLine: 2 })).toBe('48 69\n20 c3\na9')
    expect(formatByteNotation(hi, { base: 'oct', separator: 'none', prefix: 'escape' })).toBe('\\110\\151\\040\\303\\251')
  })
})

describe('detectByteBase', () => {
  it('detects from prefixes and digits', () => {
    expect(detectByteBase('0x48 0x69').base).toBe('hex')
    expect(detectByteBase('\\x48\\x69').base).toBe('hex')
    expect(detectByteBase('48 69 c3').base).toBe('hex')
    expect(detectByteBase('01001000 01101001').base).toBe('bin')
    expect(detectByteBase('1001000 1101001').base).toBe('bin')
    expect(detectByteBase('72 105 32').base).toBe('dec')
    expect(detectByteBase('110 151 040').base).toBe('oct')
    expect(detectByteBase('100 101 102')).toMatchObject({ base: 'dec', ambiguousWith: 'oct' })
    expect(detectByteBase('4869').base).toBe('hex')
  })
})

describe('parseByteNotation', () => {
  it('round-trips all bases and separators', () => {
    const t = 'Hello, 世界 😀!'
    for (const base of ['bin', 'oct', 'dec', 'hex'] as const)
      for (const sep of ['space', 'comma', 'newline'] as const) expect(roundTrip(t, base, sep), `${base}/${sep}`).toBe(t)
    for (const base of ['bin', 'oct', 'hex'] as const) expect(roundTrip(t, base, 'none')).toBe(t)
    expect(roundTrip(t, 'hex', 'none', 'escape')).toBe(t)
    expect(roundTrip(t, 'hex', 'comma', 'c')).toBe(t)
    expect(roundTrip(t, 'bin', 'space', 'c')).toBe(t)
  })
  it('auto-detects on decode', () => {
    expect(bytesToUtf8Text(parseByteNotation('0x48,0x69')).text).toBe('Hi')
    expect(bytesToUtf8Text(parseByteNotation('%48%69')).text).toBe('Hi')
    expect(bytesToUtf8Text(parseByteNotation('[72, 105]')).text).toBe('Hi')
    expect(bytesToUtf8Text(parseByteNotation('0x0b')).text).toBe('\u000b')
  })
  it('reports invalid digits with position', () => {
    const r = parseByteNotation('48 6G 69', 'hex')
    expect(r.issues[0]).toMatchObject({ offset: 4, column: 5 })
    expect(r.issues[0].message).toMatch(/"G" is not a hex digit/)
    expect(r.bytes).toEqual(Uint8Array.from([0x48, 0x69]))
  })
  it('reports incomplete bytes and out-of-range values', () => {
    expect(parseByteNotation('48656', 'hex').issues[0].message).toMatch(/Incomplete byte/)
    expect(parseByteNotation('010010000110', 'bin').issues[0].message).toMatch(/Incomplete byte.*"0110"/)
    expect(parseByteNotation('72 300', 'dec').issues[0].message).toMatch(/larger than 255/)
    expect(parseByteNotation('400', 'oct').issues[0].message).toMatch(/larger than 255/)
    expect(parseByteNotation('0b0101 0x41', 'bin').issues[0].message).toMatch(/hex prefix/)
  })
  it('reports invalid UTF-8 with source offsets', () => {
    const p = parseByteNotation('48 c3 28 69', 'hex')
    const r = bytesToUtf8Text(p)
    expect(r.text).toBe('H�(i')
    expect(r.invalid[0]).toMatchObject({ byteOffset: 1, sourceOffset: 3 })
  })
  it('handles large input', () => {
    const t = 'abc😀'.repeat(50_000)
    expect(roundTrip(t, 'hex', 'space')).toBe(t)
  })
})
