import { describe, expect, it } from 'vitest'
import { ESCAPE_FORMATS, codePoints, escapeUnicode, generalCategory, unescapeUnicode, type EscapeFormat } from './unicode'

const TEXT = 'Hé€ 😀\\ & <x>\n'

describe('escapeUnicode', () => {
  it('produces each notation', () => {
    const s = 'é😀'
    const expected: Record<EscapeFormat, string> = {
      js: '\\u00E9\\uD83D\\uDE00',
      es6: '\\u{E9}\\u{1F600}',
      hex: '\\xE9\\u{1F600}',
      python: '\\u00E9\\U0001F600',
      'html-hex': '&#xE9;&#x1F600;',
      'html-dec': '&#233;&#128512;',
      css: '\\E9 \\1F600 ',
      uplus: 'U+00E9 U+1F600',
    }
    for (const f of ESCAPE_FORMATS) expect(escapeUnicode(s, f.id).text).toBe(expected[f.id])
  })
  it('JS output is valid JavaScript / JSON', () => {
    const r = escapeUnicode(TEXT, 'js')
    expect(JSON.parse(`"${r.text}"`)).toBe(TEXT)
  })
  it('only-non-ASCII keeps ASCII but escapes conflicts', () => {
    expect(escapeUnicode('a\\b é', 'js', { onlyNonAscii: true }).text).toBe('a\\u005Cb \\u00E9')
    expect(escapeUnicode('a&b é', 'html-dec', { onlyNonAscii: true }).text).toBe('a&#38;b &#233;')
    expect(escapeUnicode('x\u0001y', 'js', { onlyNonAscii: true }).text).toBe('x\\u0001y')
  })
  it('lowercase option', () => {
    expect(escapeUnicode('é', 'js', { lowercase: true }).text).toBe('\\u00e9')
  })
  it('counts lone surrogates', () => {
    expect(escapeUnicode('a\uD800', 'js').loneSurrogates).toBe(1)
  })
  it('round-trips every format', () => {
    for (const f of ESCAPE_FORMATS)
      for (const only of [false, true]) expect(unescapeUnicode(escapeUnicode(TEXT, f.id, { onlyNonAscii: only }).text).text, `${f.id} ${only}`).toBe(TEXT)
  })
})

describe('unescapeUnicode', () => {
  it('decodes a mix of notations', () => {
    const r = unescapeUnicode('\\u0048\\u{65}\\x6c&#108;&#x6F; U+1F600 \\1F44B  %u00E9 \\U0001F680\\n')
    expect(r.text).toBe('Hello 😀 👋 é 🚀\n')
    expect(r.issues).toHaveLength(0)
    expect(r.counts.js).toBe(1)
    expect(r.counts.css).toBe(1)
  })
  it('joins surrogate pairs and flags unpaired ones', () => {
    expect(unescapeUnicode('\\uD83D\\uDE00').text).toBe('😀')
    const r = unescapeUnicode('a\\uD83Db')
    expect(r.text).toBe('a\uD83Db')
    expect(r.issues[0]).toMatchObject({ severity: 'warning', offset: 1 })
  })
  it('reports invalid sequences with positions and keeps them', () => {
    const r = unescapeUnicode('ok\n\\u12G \\u{110000} \\xZ &#xD800; \\u{12')
    expect(r.issues.map((i) => [i.line, i.column, i.raw])).toEqual([
      [2, 1, '\\u12'],
      [2, 7, '\\u{110000}'],
      [2, 18, '\\x'],
      [2, 22, '&#xD800;'],
      [2, 31, '\\u{12'],
    ])
    expect(r.text).toBe('ok\n\\u12G \\u{110000} \\xZ &#xD800; \\u{12')
  })
  it('handles ambiguous single-char escapes', () => {
    expect(unescapeUnicode('\\d').issues[0].severity).toBe('warning')
    expect(unescapeUnicode('a\\tb').text).toBe('a\tb')
    expect(unescapeUnicode('\\A ').text).toBe('\n')
  })
  it('handles large input', () => {
    const big = '\\u00E9\\uD83D\\uDE00 '.repeat(100_000)
    expect(unescapeUnicode(big).text).toBe('é😀 '.repeat(100_000))
  })
})

describe('codePoints', () => {
  it('lists code points with UTF-8/UTF-16 units', () => {
    const { items, total } = codePoints('a😀\uD800')
    expect(total).toBe(3)
    expect(items[1]).toMatchObject({ cp: 0x1f600, offset: 1, utf8: [0xf0, 0x9f, 0x98, 0x80], utf16: [0xd83d, 0xde00] })
    expect(items[2].lone).toBe(true)
  })
  it('respects the limit', () => {
    expect(codePoints('abcdef', 2)).toMatchObject({ total: 6 })
    expect(codePoints('abcdef', 2).items).toHaveLength(2)
  })
  it('categorises', () => {
    expect(generalCategory(0x41)).toBe('Lu')
    expect(generalCategory(0x1f600)).toBe('So')
    expect(generalCategory(0x20)).toBe('Zs')
    expect(generalCategory(0x200d)).toBe('Cf')
  })
})
