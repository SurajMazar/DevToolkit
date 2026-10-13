import { describe, expect, it } from 'vitest'
import { UrlCodecError, decodeUrl, encodeUrl } from './url'

const SAMPLES = ['hello world', "a+b=c&d/e?f#g:h@i;j,k!l*m'n(o)p~q_r.s-t", 'café 東京 😀', '100% sure', '\t\n\r', '"<>`{|}^\\[]']

describe('encodeUrl', () => {
  it('component mode matches encodeURIComponent', () => {
    for (const s of SAMPLES) expect(encodeUrl(s, { mode: 'component' })).toBe(encodeURIComponent(s))
  })
  it('uri mode matches encodeURI', () => {
    for (const s of SAMPLES) expect(encodeUrl(s, { mode: 'uri' })).toBe(encodeURI(s))
  })
  it('form mode matches URLSearchParams', () => {
    for (const s of SAMPLES) expect(encodeUrl(s, { mode: 'form' })).toBe(new URLSearchParams({ x: s }).toString().slice(2))
  })
  it('all mode encodes every character', () => {
    expect(encodeUrl('Ab1-', { mode: 'all' })).toBe('%41%62%31%2D')
    expect(encodeUrl('é', { mode: 'all', lowercase: true })).toBe('%c3%a9')
  })
  it('keeps line breaks in per-line mode', () => {
    expect(encodeUrl('a b\r\nc d\ne', { mode: 'component', perLine: true })).toBe('a%20b\r\nc%20d\ne')
    expect(encodeUrl('a b\nc', { mode: 'component' })).toBe('a%20b%0Ac')
  })
  it('reports lone surrogates with position', () => {
    try {
      encodeUrl('ok\nx\uD800y', { mode: 'component' })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(UrlCodecError)
      expect((e as UrlCodecError).offset).toBe(4)
      expect((e as UrlCodecError).line).toBe(2)
      expect((e as UrlCodecError).column).toBe(2)
    }
  })
  it('encodes large input', () => {
    const s = 'key=välue & more '.repeat(50_000)
    expect(encodeUrl(s, { mode: 'component' })).toBe(encodeURIComponent(s))
  })
})

describe('decodeUrl', () => {
  it('decodes like decodeURIComponent for valid input', () => {
    for (const s of SAMPLES) {
      const enc = encodeURIComponent(s)
      const r = decodeUrl(enc)
      expect(r.text).toBe(s)
      expect(r.issues).toHaveLength(0)
    }
  })
  it('treats + as space only when asked', () => {
    expect(decodeUrl('a+b%20c').text).toBe('a+b c')
    expect(decodeUrl('a+b%20c', { plusAsSpace: true }).text).toBe('a b c')
    expect(decodeUrl('a%2Bb', { plusAsSpace: true }).text).toBe('a+b')
  })
  it('detects a truncated UTF-8 sequence with exact position', () => {
    const r = decodeUrl('abc%E0%A4%A')
    expect(r.failed).toBe(true)
    expect(r.text).toBe('')
    expect(r.issues).toHaveLength(2)
    expect(r.issues[0]).toMatchObject({ offset: 3, length: 6, source: '%E0%A4', column: 4 })
    expect(r.issues[0].message).toMatch(/3-byte sequence/)
    expect(r.issues[1]).toMatchObject({ offset: 9, source: '%A' })
  })
  it('detects invalid escapes', () => {
    const r = decodeUrl('x%ZZy')
    expect(r.issues[0]).toMatchObject({ offset: 1, source: '%ZZ' })
    expect(decodeUrl('50%').issues[0].message).toMatch(/end of the input/)
  })
  it('detects invalid UTF-8 bytes', () => {
    const r = decodeUrl('%C3%28')
    expect(r.issues[0].source).toBe('%C3')
    expect(decodeUrl('%FF').issues[0].message).toMatch(/never appears/)
    expect(decodeUrl('%ED%A0%80').issues[0].message).toMatch(/surrogate/)
    expect(decodeUrl('%C0%AF').issues[0].message).toMatch(/overlong/)
  })
  it('lenient mode keeps malformed sequences as-is', () => {
    const r = decodeUrl('caf%C3%A9 %E0%A4 100%', { lenient: true })
    expect(r.failed).toBe(false)
    expect(r.text).toBe('café %E0%A4 100%')
    expect(r.issues).toHaveLength(2)
  })
  it('per-line mode leaves bad lines unchanged', () => {
    const r = decodeUrl('a%20b\nbad%ZZ\nc%C3%A9', { perLine: true })
    expect(r.text).toBe('a b\nbad%ZZ\ncé')
    expect(r.skippedLines).toBe(1)
    expect(r.issues[0].line).toBe(2)
  })
  it('flags double encoding', () => {
    expect(decodeUrl('a%2520b').stillEncoded).toBe(true)
    expect(decodeUrl('a%20b').stillEncoded).toBe(false)
  })
  it('handles astral characters and large input', () => {
    expect(decodeUrl('%F0%9F%98%80').text).toBe('😀')
    const big = encodeURIComponent('😀 ü '.repeat(100_000))
    expect(decodeUrl(big).text).toBe('😀 ü '.repeat(100_000))
  })
})
