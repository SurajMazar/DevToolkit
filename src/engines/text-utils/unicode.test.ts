import { describe, expect, it } from 'vitest'
import {
  codePointsOf,
  confusableWith,
  cssEscape,
  describeCodePoint,
  displayGlyph,
  generalCategory,
  htmlEntity,
  jsEscape,
  jsonEscape,
  represent,
  scriptOf,
  segmentCodePoints,
  segmentGraphemes,
  summarizeUnicode,
  utf16Units,
  utf8Bytes,
} from './unicode'

const cp = (s: string) => s.codePointAt(0)!

describe('general category', () => {
  it('derives categories from Unicode properties', () => {
    expect(generalCategory(cp('A'))).toEqual({ code: 'Lu', name: 'Uppercase letter' })
    expect(generalCategory(cp('é')).code).toBe('Ll')
    expect(generalCategory(cp('ǅ')).code).toBe('Lt')
    expect(generalCategory(cp('中')).code).toBe('Lo')
    expect(generalCategory(0x0301).code).toBe('Mn')
    expect(generalCategory(cp('5')).code).toBe('Nd')
    expect(generalCategory(cp('Ⅻ')).code).toBe('Nl')
    expect(generalCategory(cp('½')).code).toBe('No')
    expect(generalCategory(cp('_')).code).toBe('Pc')
    expect(generalCategory(cp('-')).code).toBe('Pd')
    expect(generalCategory(cp('(')).code).toBe('Ps')
    expect(generalCategory(cp(')')).code).toBe('Pe')
    expect(generalCategory(cp('«')).code).toBe('Pi')
    expect(generalCategory(cp('!')).code).toBe('Po')
    expect(generalCategory(cp('+')).code).toBe('Sm')
    expect(generalCategory(cp('€')).code).toBe('Sc')
    expect(generalCategory(cp('^')).code).toBe('Sk')
    expect(generalCategory(cp('😀')).code).toBe('So')
    expect(generalCategory(0x20).code).toBe('Zs')
    expect(generalCategory(0x2028).code).toBe('Zl')
    expect(generalCategory(0x2029).code).toBe('Zp')
    expect(generalCategory(0x0a).code).toBe('Cc')
    expect(generalCategory(0x200b).code).toBe('Cf')
    expect(generalCategory(0xd800).code).toBe('Cs')
    expect(generalCategory(0xe000).code).toBe('Co')
    expect(generalCategory(0x0378).code).toBe('Cn')
  })
})

describe('script', () => {
  it('detects common scripts', () => {
    expect(scriptOf(cp('a'))).toBe('Latin')
    expect(scriptOf(cp('а'))).toBe('Cyrillic')
    expect(scriptOf(cp('α'))).toBe('Greek')
    expect(scriptOf(cp('中'))).toBe('Han')
    expect(scriptOf(cp('ひ'))).toBe('Hiragana')
    expect(scriptOf(cp('한'))).toBe('Hangul')
    expect(scriptOf(cp('ع'))).toBe('Arabic')
    expect(scriptOf(cp('क'))).toBe('Devanagari')
    expect(scriptOf(cp('1'))).toBe('Common')
    expect(scriptOf(0x0301)).toBe('Inherited')
    expect(scriptOf(0xd800)).toBe('Unknown')
  })
})

describe('encodings and escapes', () => {
  it('encodes UTF-8 and UTF-16', () => {
    expect(utf8Bytes(0x41)).toEqual([0x41])
    expect(utf8Bytes(0xe9)).toEqual([0xc3, 0xa9])
    expect(utf8Bytes(0x20ac)).toEqual([0xe2, 0x82, 0xac])
    expect(utf8Bytes(0x1f600)).toEqual([0xf0, 0x9f, 0x98, 0x80])
    expect(utf8Bytes(0xd800)).toEqual([0xef, 0xbf, 0xbd])
    expect(utf16Units(0x1f600)).toEqual([0xd83d, 0xde00])
    expect(utf16Units(0x41)).toEqual([0x41])
  })

  it('matches TextEncoder for a mixed string', () => {
    const s = 'aé€😀中'
    expect(represent(codePointsOf(s), 'utf8')).toBe(Array.from(new TextEncoder().encode(s), (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '))
  })

  it('produces HTML, JS, JSON, CSS and URL escapes', () => {
    expect(htmlEntity(0x26)).toBe('&amp;')
    expect(htmlEntity(0xe9)).toBe('&eacute;')
    expect(htmlEntity(0x1f600)).toBe('&#x1F600;')
    expect(jsEscape(0xe9)).toBe('\\u00E9')
    expect(jsEscape(0x1f600)).toBe('\\u{1F600}')
    expect(jsonEscape(0x1f600)).toBe('\\uD83D\\uDE00')
    expect(JSON.parse(`"${jsonEscape(0x1f600)}"`)).toBe('😀')
    expect(cssEscape(0xe9)).toBe('\\E9 ')
    expect(represent([0x65, 0x301], 'css')).toBe('\\65 \\301')
    expect(represent([0x1f600], 'url')).toBe(encodeURIComponent('😀'))
    expect(represent([0x65, 0x301], 'codepoint')).toBe('U+0065 U+0301')
    expect(represent([0x65, 0x301], 'char')).toBe('é')
    expect(represent([0x1f600], 'decimal')).toBe('128512')
    expect(represent([0x1f600], 'utf16')).toBe('D83D DE00')
  })
})

describe('flags', () => {
  it('flags invisible, combining and confusable characters', () => {
    expect(describeCodePoint(0x200b).flags).toContain('invisible')
    expect(describeCodePoint(0x200b).label).toBe('ZWSP')
    expect(describeCodePoint(0xa0).flags).toContain('invisible')
    expect(describeCodePoint(0x20).flags).not.toContain('invisible')
    expect(describeCodePoint(0x0301).flags).toContain('combining')
    expect(describeCodePoint(0x0430).flags).toContain('confusable')
    expect(describeCodePoint(0x0430).confusable).toBe('a')
    expect(describeCodePoint(0x61).flags).toEqual([])
    expect(describeCodePoint(0xfe0f).flags).toContain('variation-selector')
    expect(describeCodePoint(0x1f3fd).flags).toContain('emoji-modifier')
    expect(describeCodePoint(0x00).flags).toContain('control')
    expect(describeCodePoint(0x00).label).toBe('NUL')
    expect(describeCodePoint(0x0a).label).toBe('LF')
    expect(describeCodePoint(0x0a).flags).toEqual([]) // ordinary line break, not flagged
  })

  it('detects fullwidth and mathematical lookalikes', () => {
    expect(confusableWith(0xff21)).toBe('A')
    expect(confusableWith(0x1d400)).toBe('A')
    expect(confusableWith(cp('b'))).toBeNull()
  })

  it('displays invisible glyphs as labels and combining marks on a dotted circle', () => {
    expect(displayGlyph([0x200b])).toEqual({ text: 'ZWSP', special: true })
    expect(displayGlyph([0x0301])).toEqual({ text: '◌́', special: false })
    expect(displayGlyph([0x65, 0x301])).toEqual({ text: 'é', special: false })
    expect(displayGlyph([0x0378])).toEqual({ text: 'U+0378', special: true })
  })
})

describe('segmentation', () => {
  const text = 'é👩‍💻🇯🇵a'
  it('splits by code point with UTF-16 offsets', () => {
    const r = segmentCodePoints(text)
    expect(r.units.map((u) => u.cps.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
    expect(r.units.map((u) => u.offset)).toEqual([0, 1, 2, 4, 5, 7, 9, 11])
  })

  it('splits by grapheme cluster', () => {
    const r = segmentGraphemes(text)
    expect(r.units.map((u) => u.cps.length)).toEqual([2, 3, 2, 1])
    expect(r.units[1].cps).toEqual([0x1f469, 0x200d, 0x1f4bb])
  })

  it('handles lone surrogates and limits explicitly', () => {
    expect(segmentCodePoints('a\ud800b').units.map((u) => u.cps[0])).toEqual([0x61, 0xd800, 0x62])
    const r = segmentCodePoints('abcdef', 3)
    expect(r.units).toHaveLength(3)
    expect(r.truncated).toBe(true)
    expect(segmentGraphemes('abc', 10).truncated).toBe(false)
    expect(segmentCodePoints('').units).toEqual([])
  })
})

describe('summarizeUnicode', () => {
  it('counts code points, graphemes, UTF-16 units and UTF-8 bytes', () => {
    const s = summarizeUnicode('café 👩‍💻 раураl​')
    expect(s.codePoints).toBe(Array.from('café 👩‍💻 раураl​').length)
    expect(s.utf16Units).toBe('café 👩‍💻 раураl​'.length)
    expect(s.utf8Bytes).toBe(new TextEncoder().encode('café 👩‍💻 раураl​').length)
    expect(s.graphemes).toBe(4 + 1 + 1 + 1 + 6 + 1)
    expect(s.invisible).toBe(2) // ZWJ + ZWSP
    expect(s.confusable).toBe(5) // р а у р а
    expect(s.scripts[0].name).toBe('Latin')
    expect(s.scripts.some((x) => x.name === 'Cyrillic')).toBe(true)
  })

  it('reports normalization forms and handles empty input', () => {
    expect(summarizeUnicode('é').normalization).toEqual({ nfc: false, nfd: true, nfkc: false })
    expect(summarizeUnicode('é').normalization.nfc).toBe(true)
    const e = summarizeUnicode('')
    expect(e.codePoints).toBe(0)
    expect(e.graphemes).toBe(0)
  })

  it('handles large input', () => {
    const big = 'Hello, мир! 你好 😀\n'.repeat(20_000)
    const t0 = performance.now()
    const s = summarizeUnicode(big)
    expect(s.utf16Units).toBe(big.length)
    expect(s.codePoints).toBe(Array.from(big).length)
    expect(performance.now() - t0).toBeLessThan(3000)
    expect(segmentCodePoints(big, 100_000).truncated).toBe(true)
  })
})
