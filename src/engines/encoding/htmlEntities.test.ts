import { describe, expect, it } from 'vitest'
import { COMMON_ENTITIES, decodeEntities, encodeEntities, entityForms } from './htmlEntities'

describe('encodeEntities', () => {
  const s = `<a href="x">Tom & Jerry's café 😀</a>`
  it('escapes only HTML-special characters', () => {
    expect(encodeEntities(s, { scope: 'special', format: 'named' })).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s café 😀&lt;/a&gt;')
    expect(encodeEntities('<&>', { scope: 'special', format: 'decimal' })).toBe('&#60;&#38;&#62;')
    expect(encodeEntities('<&>', { scope: 'special', format: 'hex' })).toBe('&#x3C;&#x26;&#x3E;')
  })
  it('escapes non-ASCII too', () => {
    expect(encodeEntities('café © 😀 <', { scope: 'nonAscii', format: 'named' })).toBe('caf&eacute; &copy; &#x1F600; &lt;')
    expect(encodeEntities('café 😀', { scope: 'nonAscii', format: 'decimal' })).toBe('caf&#233; &#128512;')
    expect(encodeEntities('café 😀', { scope: 'nonAscii', format: 'hex' })).toBe('caf&#xE9; &#x1F600;')
    expect(encodeEntities("'", { scope: 'nonAscii', format: 'named' })).toBe('&#39;')
  })
  it('can encode everything', () => {
    expect(encodeEntities('ab', { scope: 'everything', format: 'hex' })).toBe('&#x61;&#x62;')
  })
  it('round-trips', () => {
    for (const scope of ['special', 'nonAscii', 'everything'] as const)
      for (const format of ['named', 'decimal', 'hex'] as const) expect(decodeEntities(encodeEntities(s, { scope, format })).text).toBe(s)
  })
})

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    const r = decodeEntities('&lt;p&gt; &copy; &#169; &#xA9; &#X1F600; &NotNestedGreaterGreater;')
    expect(r.text).toBe('<p> © © © 😀 ⪢̸')
    expect(r.references).toBe(7)
    expect(r.notes).toHaveLength(0)
  })
  it('notes legacy references without semicolon', () => {
    const r = decodeEntities('a &amp b &copy c')
    expect(r.text).toBe('a & b © c')
    expect(r.notes.map((n) => n.kind)).toEqual(['no-semicolon', 'no-semicolon'])
  })
  it('explains ambiguous legacy prefixes', () => {
    const r = decodeEntities('&notit;')
    expect(r.text).toBe('¬it;')
    expect(r.notes[0]).toMatchObject({ kind: 'legacy-prefix', raw: '&notit;' })
    expect(r.notes[0].message).toContain('&not')
  })
  it('notes Windows-1252 remapping and replacement characters', () => {
    const r = decodeEntities('&#150; &#0; &#xD800; &#x110000;')
    expect(r.text).toBe('– � � �')
    expect(r.notes.map((n) => n.kind)).toEqual(['windows-1252', 'replacement', 'replacement', 'replacement'])
  })
  it('leaves unknown names and reports them', () => {
    const r = decodeEntities('&foo; &hellip')
    expect(r.text).toBe('&foo; &hellip')
    expect(r.notes.map((n) => n.kind)).toEqual(['unknown', 'unknown'])
    expect(r.notes[1].line).toBe(1)
    expect(r.notes[1].column).toBe(7)
  })
  it('applies attribute-value rules', () => {
    expect(decodeEntities('?a=1&copy=2', { attribute: true }).text).toBe('?a=1&copy=2')
    expect(decodeEntities('?a=1&copy=2').text).toBe('?a=1©=2')
  })
  it('handles large input', () => {
    const big = '&lt;div class=&quot;x&quot;&gt;caf&eacute;&lt;/div&gt;\n'.repeat(20_000)
    expect(decodeEntities(big).text).toBe('<div class="x">café</div>\n'.repeat(20_000))
  })
})

describe('reference', () => {
  it('every common entity decodes to its character', () => {
    for (const e of COMMON_ENTITIES) {
      expect(decodeEntities(e.name).text).toBe(e.char)
      const f = entityForms(e.char)
      expect(decodeEntities(f.decimal).text).toBe(e.char)
      expect(decodeEntities(f.hex).text).toBe(e.char)
    }
  })
})
