import { describe, expect, it } from 'vitest'
import { decodeBase64, encodeBase64, sniffMime, base64ToBytes } from './base64'

describe('base64', () => {
  it('round-trips unicode', () => {
    const s = 'Hello, 世界 ✓ café 👩‍💻'
    expect(decodeBase64(encodeBase64(s)).text).toBe(s)
  })
  it('matches known vectors', () => {
    expect(encodeBase64('')).toBe('')
    expect(encodeBase64('f')).toBe('Zg==')
    expect(encodeBase64('foobar')).toBe('Zm9vYmFy')
    expect(encodeBase64('✓')).toBe('4pyT')
  })
  it('supports url-safe without padding', () => {
    expect(encodeBase64('>>>???', { urlSafe: true, noPadding: true })).toBe('Pj4-Pz8_')
    expect(decodeBase64('Pj4-Pz8_').text).toBe('>>>???')
  })
  it('wraps lines', () => expect(encodeBase64('a'.repeat(60), { lineLength: 76 }).split('\n')[0]).toHaveLength(76))
  it('decodes with whitespace and missing padding', () => expect(decodeBase64(' Zm9v\nYmE ').text).toBe('fooba'))
  it('rejects invalid characters with position', () => {
    expect(() => base64ToBytes('Zm9v*YmFy')).toThrow(/Invalid character "\*"/)
  })
  it('rejects bad padding and truncation', () => {
    expect(() => base64ToBytes('Zm=9v')).toThrow(/Padding/)
    expect(() => base64ToBytes('Zm9vY')).toThrow(/Invalid length/)
  })
  it('flags non-UTF-8 output', () => expect(decodeBase64('/w==').isUtf8).toBe(false))
  it('handles large input', () => {
    const big = 'x'.repeat(3_000_000)
    expect(decodeBase64(encodeBase64(big)).text.length).toBe(3_000_000)
  })
  it('sniffs mime types', () => expect(sniffMime(base64ToBytes('iVBORw0KGgo='))).toBe('image/png'))
})
