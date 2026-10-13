import { describe, expect, it } from 'vitest'
import {
  applyCleanups,
  classifyCodePoint,
  indexLines,
  normalizeLineEndings,
  removeFormatChars,
  removeZeroWidth,
  spacesToTabs,
  summarizeWhitespace,
  tabsToSpaces,
  tokenizeLine,
  trailingStart,
  trimTrailingWhitespace,
  nbspToSpace,
  unicodeSpacesToSpace,
  hasAnyCleanup,
} from './whitespace'

describe('classifyCodePoint', () => {
  it('classifies common invisible characters', () => {
    expect(classifyCodePoint(0x20)?.kind).toBe('space')
    expect(classifyCodePoint(0x09)?.kind).toBe('tab')
    expect(classifyCodePoint(0xa0)).toMatchObject({ kind: 'nbsp', abbr: 'NBSP' })
    for (const cp of [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]) expect(classifyCodePoint(cp)?.kind).toBe('zero-width')
    expect(classifyCodePoint(0x2003)).toMatchObject({ kind: 'unicode-space', abbr: 'EMSP' })
    expect(classifyCodePoint(0x2009)).toMatchObject({ kind: 'unicode-space', abbr: 'THSP' })
    expect(classifyCodePoint(0x202e)).toMatchObject({ kind: 'format', abbr: 'RLO' })
    expect(classifyCodePoint(0x00)).toMatchObject({ kind: 'control', abbr: 'NUL' })
    expect(classifyCodePoint(0x1b)).toMatchObject({ kind: 'control', abbr: 'ESC' })
    expect(classifyCodePoint(0x2028)?.kind).toBe('line-separator')
  })

  it('falls back to Unicode properties for unlisted Cf/Zs characters', () => {
    expect(classifyCodePoint(0xe0001)).toMatchObject({ kind: 'format', abbr: 'U+E0001' }) // LANGUAGE TAG
    expect(classifyCodePoint(0x0600)?.kind).toBe('format') // ARABIC NUMBER SIGN
  })

  it('ignores visible characters and line breaks', () => {
    for (const ch of ['a', 'é', '中', '😀', '\n', '\r']) expect(classifyCodePoint(ch.codePointAt(0)!)).toBeNull()
  })
})

describe('indexLines', () => {
  it('handles LF, CRLF, CR and no final newline', () => {
    const idx = indexLines('a\nb\r\nc\rd')
    expect(idx.count).toBe(4)
    expect(Array.from(idx.eols)).toEqual([1, 2, 3, 0])
    expect(Array.from(idx.starts)).toEqual([0, 2, 5, 7])
    expect(Array.from(idx.ends)).toEqual([1, 3, 6, 8])
  })

  it('creates an empty last line after a final newline', () => {
    const idx = indexLines('a\n')
    expect(idx.count).toBe(2)
    expect(idx.ends[1] - idx.starts[1]).toBe(0)
  })

  it('handles empty input and grows beyond the initial capacity', () => {
    expect(indexLines('').count).toBe(1)
    const big = 'x\n'.repeat(5000)
    expect(indexLines(big).count).toBe(5001)
  })
})

describe('tokenizeLine', () => {
  it('produces space, tab and special tokens with trailing flags', () => {
    const { tokens } = tokenizeLine('a b\tc d​  ')
    expect(tokens).toEqual([
      { t: 'text', v: 'a' },
      { t: 'space', n: 1, trailing: false },
      { t: 'text', v: 'b' },
      { t: 'tab', width: 1, trailing: false },
      { t: 'text', v: 'c' },
      expect.objectContaining({ t: 'special', cp: 0xa0, trailing: false }),
      { t: 'text', v: 'd' },
      expect.objectContaining({ t: 'special', cp: 0x200b, trailing: true }),
      { t: 'space', n: 2, trailing: true },
    ])
  })

  it('expands tabs to tab stops', () => {
    const { tokens } = tokenizeLine('\tab\t', 4)
    expect(tokens[0]).toEqual({ t: 'tab', width: 4, trailing: false })
    expect(tokens[2]).toEqual({ t: 'tab', width: 2, trailing: true })
  })

  it('keeps astral characters intact and truncates very long lines explicitly', () => {
    expect(tokenizeLine('😀👩‍💻').tokens.map((t) => (t.t === 'text' ? t.v : t.t))).toEqual(['😀👩', 'special', '💻'])
    const r = tokenizeLine('x'.repeat(5000), 4, 100)
    expect(r.truncated).toBe(4900)
  })

  it('trailingStart finds trailing whitespace incl. zero-width', () => {
    expect(trailingStart('abc')).toBe(3)
    expect(trailingStart('abc \t')).toBe(3)
    expect(trailingStart('abc​ ')).toBe(3)
    expect(trailingStart('   ')).toBe(0)
  })
})

describe('summarizeWhitespace', () => {
  it('counts each kind with first occurrence and line endings', () => {
    const text = 'ab \r\n\tc d\nzero​width\r em'
    const s = summarizeWhitespace(text)
    expect(s.counts.space).toEqual({ count: 1, first: { line: 1, column: 3 } })
    expect(s.counts.tab).toEqual({ count: 1, first: { line: 2, column: 1 } })
    expect(s.counts.nbsp.first).toEqual({ line: 2, column: 3 })
    expect(s.counts['zero-width']).toEqual({ count: 1, first: { line: 3, column: 5 } })
    expect(s.counts['unicode-space'].count).toBe(1)
    expect(s.counts.trailing).toEqual({ count: 1, first: { line: 1, column: 3 } })
    expect(s.counts.CRLF.count).toBe(1)
    expect(s.counts.LF.count).toBe(1)
    expect(s.counts.CR.count).toBe(1)
    expect(s.eol.mixed).toBe(true)
    expect(s.lines).toBe(4)
    expect(s.specials.get(0x200b)?.count).toBe(1)
  })

  it('detects a single line-ending style, final newline and BOM', () => {
    const s = summarizeWhitespace('﻿a\r\nb\r\n')
    expect(s.eol).toEqual({ dominant: 'CRLF', mixed: false, finalNewline: true })
    expect(s.hasBom).toBe(true)
    expect(s.counts['zero-width'].count).toBe(1)
  })

  it('counts mixed indentation and handles empty input', () => {
    expect(summarizeWhitespace(' \tx\n\t y\nz').mixedIndentLines).toBe(2)
    const e = summarizeWhitespace('')
    expect(e.lines).toBe(0)
    expect(e.eol.dominant).toBeNull()
  })

  it('handles astral format characters', () => {
    const s = summarizeWhitespace('flag\u{e0067}\u{e007f}')
    expect(s.counts.format.count).toBe(2)
  })

  it('summarizes 100k lines quickly', () => {
    const text = 'const value = 1;  \r\n\tlet x = 2;\n'.repeat(50_000)
    const t0 = performance.now()
    const s = summarizeWhitespace(text)
    expect(s.lines).toBe(100_001)
    expect(s.counts.trailing.count).toBe(50_000)
    expect(s.counts.nbsp.count).toBe(50_000)
    expect(s.eol.mixed).toBe(true)
    expect(performance.now() - t0).toBeLessThan(2000)
  })
})

describe('cleanups', () => {
  it('removes zero-width characters but keeps emoji ZWJ sequences by default', () => {
    const text = 'a​b﻿c⁠d 👩‍💻 👨‍👩‍👧 🏳️‍🌈 x‍y'
    expect(removeZeroWidth(text)).toBe('abcd 👩‍💻 👨‍👩‍👧 🏳️‍🌈 xy')
    expect(removeZeroWidth(text, false)).toBe('abcd 👩💻 👨👩👧 🏳️🌈 xy')
  })

  it('keeps emoji ZWJ even when the text contains the internal placeholder', () => {
    const text = '\u0000ZWJ\u0000 👩‍💻 a​b'
    expect(removeZeroWidth(text)).toBe('\u0000ZWJ\u0000 👩‍💻 ab')
  })

  it('converts NBSP and Unicode spaces to regular spaces', () => {
    expect(nbspToSpace('a b c')).toBe('a b c')
    expect(unicodeSpacesToSpace('a b c　d')).toBe('a b c d')
  })

  it('removes bidi and other format characters', () => {
    expect(removeFormatChars('a‮b‎c­d')).toBe('abcd')
  })

  it('trims trailing whitespace on every line, preserving line endings', () => {
    expect(trimTrailingWhitespace('a  \r\nb\t\nc \rd ​')).toBe('a\r\nb\nc\rd')
  })

  it('normalizes line endings', () => {
    expect(normalizeLineEndings('a\r\nb\rc\nd', 'LF')).toBe('a\nb\nc\nd')
    expect(normalizeLineEndings('a\r\nb\rc\nd', 'CRLF')).toBe('a\r\nb\r\nc\r\nd')
    expect(normalizeLineEndings('a\nb', 'CR')).toBe('a\rb')
  })

  it('converts tabs to spaces using tab stops', () => {
    expect(tabsToSpaces('\tx\ty', 4)).toBe('    x   y')
    expect(tabsToSpaces('ab\tc\r\n\td', 4)).toBe('ab  c\r\n    d')
    expect(tabsToSpaces('no tabs', 4)).toBe('no tabs')
  })

  it('converts leading spaces to tabs only in indentation', () => {
    expect(spacesToTabs('        x  y\n  z', 4)).toBe('\t\tx  y\n  z')
    expect(spacesToTabs('      x', 4)).toBe('\t  x')
    expect(spacesToTabs(' \t x', 4)).toBe('\t x')
  })

  it('applies combined cleanups in a stable order', () => {
    const o = { removeZeroWidth: true, nbspToSpace: true, trimTrailing: true, normalizeEol: 'LF' as const, tabs: 'to-spaces' as const, tabSize: 2 }
    expect(applyCleanups('\ta b​ \r\nc\t\r', o)).toBe('  a b\nc\n')
    expect(hasAnyCleanup({})).toBe(false)
    expect(hasAnyCleanup(o)).toBe(true)
  })
})
