import { describe, expect, it } from 'vitest'
import { analyzeUtf8, codePointToUtf8, decodeUtf8At, decodeUtf8Lenient, detectBom, encodeUtf8, lineColumnAt, sequenceContaining } from './utf8'

const b = (...xs: number[]) => Uint8Array.from(xs)

describe('decodeUtf8At', () => {
  it('decodes 1–4 byte sequences', () => {
    expect(decodeUtf8At(b(0x41), 0)).toMatchObject({ cp: 0x41, length: 1 })
    expect(decodeUtf8At(b(0xc3, 0xa9), 0)).toMatchObject({ cp: 0xe9, length: 2 })
    expect(decodeUtf8At(b(0xe2, 0x82, 0xac), 0)).toMatchObject({ cp: 0x20ac, length: 3 })
    expect(decodeUtf8At(b(0xf0, 0x9f, 0x98, 0x80), 0)).toMatchObject({ cp: 0x1f600, length: 4 })
  })

  it('classifies malformed input', () => {
    expect(decodeUtf8At(b(0x80), 0)).toMatchObject({ cp: -1, problem: 'unexpected-continuation', length: 1 })
    expect(decodeUtf8At(b(0xc0, 0x80), 0)).toMatchObject({ cp: -1, problem: 'overlong', length: 1 })
    expect(decodeUtf8At(b(0xe0, 0x80, 0x80), 0)).toMatchObject({ cp: -1, problem: 'overlong', length: 1 })
    expect(decodeUtf8At(b(0xed, 0xa0, 0x80), 0)).toMatchObject({ cp: -1, problem: 'surrogate' })
    expect(decodeUtf8At(b(0xf4, 0x90, 0x80, 0x80), 0)).toMatchObject({ cp: -1, problem: 'too-large' })
    expect(decodeUtf8At(b(0xff), 0)).toMatchObject({ cp: -1, problem: 'invalid-byte' })
    expect(decodeUtf8At(b(0xe0, 0xa4), 0)).toMatchObject({ cp: -1, problem: 'truncated', length: 2, expected: 3 })
    expect(decodeUtf8At(b(0xe0, 0xa4, 0x41), 0)).toMatchObject({ cp: -1, problem: 'truncated', length: 2 })
  })
})

describe('decodeUtf8Lenient', () => {
  it('matches TextDecoder replacement behaviour and reports issues', () => {
    const cases = [b(0x61, 0xe0, 0xa4, 0x62), b(0xf0, 0x9f, 0x98), b(0x80, 0x80, 0x41), b(0xed, 0xa0, 0x80), b(0xc3, 0x28), b(0xf4, 0x90, 0x80, 0x80, 0x41)]
    for (const c of cases) {
      const r = decodeUtf8Lenient(c)
      expect(r.text).toBe(new TextDecoder().decode(c))
      expect(r.issueCount).toBeGreaterThan(0)
    }
    const r = decodeUtf8Lenient(b(0x61, 0xe0, 0xa4, 0x62))
    expect(r.issues[0]).toMatchObject({ offset: 1, length: 2, problem: 'truncated' })
    expect(r.issues[0].message).toContain('E0 A4 starts a 3-byte sequence')
  })

  it('passes valid text through', () => {
    const s = 'héllo 😀 東京'
    expect(decodeUtf8Lenient(encodeUtf8(s))).toMatchObject({ text: s, issueCount: 0 })
  })
})

describe('analyzeUtf8', () => {
  it('counts sequences by length and detects BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encodeUtf8('aé€😀\n')])
    const s = analyzeUtf8(bytes)
    expect(s.bom?.kind).toBe('utf-8')
    expect(s.counts.slice(1)).toEqual([2, 1, 2, 1]) // a, \n · é · BOM, € · 😀
    expect(s.asciiOnly).toBe(false)
    expect(s.lines).toBe(2)
  })

  it('flags invalid bytes and ascii-only', () => {
    expect(analyzeUtf8(encodeUtf8('plain ascii')).asciiOnly).toBe(true)
    const s = analyzeUtf8(b(0x41, 0xff, 0x42, 0xc3))
    expect(s.invalidSequences).toBe(2)
    expect(s.issues.map((i) => i.offset)).toEqual([1, 3])
    expect(s.asciiOnly).toBe(false)
  })

  it('handles a multi-MB buffer', () => {
    const big = encodeUtf8('ab€😀'.repeat(300_000))
    const s = analyzeUtf8(big)
    expect(s.counts[4]).toBe(300_000)
    expect(s.invalidSequences).toBe(0)
  })
})

describe('helpers', () => {
  it('finds the sequence containing a byte', () => {
    const bytes = encodeUtf8('a😀b')
    expect(sequenceContaining(bytes, 3)).toMatchObject({ start: 1, length: 4, cp: 0x1f600 })
    expect(sequenceContaining(b(0xc2, 0x80, 0x80), 2)).toMatchObject({ start: 2, cp: -1 })
  })
  it('encodes code points like TextEncoder', () => {
    for (const cp of [0x41, 0xe9, 0x20ac, 0x1f600, 0x10ffff]) expect(codePointToUtf8(cp)).toEqual(Array.from(encodeUtf8(String.fromCodePoint(cp))))
  })
  it('detects UTF-16 BOMs', () => {
    expect(detectBom(b(0xff, 0xfe, 0x41, 0x00))?.kind).toBe('utf-16le')
    expect(detectBom(b(0xfe, 0xff))?.kind).toBe('utf-16be')
    expect(detectBom(b(0x41))).toBeNull()
  })
  it('maps offsets to line/column', () => {
    expect(lineColumnAt('ab\ncd', 4)).toEqual({ line: 2, column: 2 })
    expect(lineColumnAt('abc', 0)).toEqual({ line: 1, column: 1 })
  })
})
