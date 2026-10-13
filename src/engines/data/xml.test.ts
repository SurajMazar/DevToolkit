import { describe, expect, it } from 'vitest'
import { conventionExample, DEFAULT_JSON_TO_XML as JX, DEFAULT_XML_TO_JSON as XJ, isValidXmlName, jsonToXml, sanitizeXmlName, xmlToJson, type JsonToXmlOptions, type XmlToJsonOptions } from './xml'

const x2j = (s: string, o: Partial<XmlToJsonOptions> = {}) => xmlToJson(s, { ...XJ, ...o })
const x2v = (s: string, o: Partial<XmlToJsonOptions> = {}) => {
  const r = x2j(s, o)
  if (r.error) throw new Error(r.error.message)
  return JSON.parse(r.output)
}
const j2x = (v: unknown, o: Partial<JsonToXmlOptions> = {}) => jsonToXml(typeof v === 'string' ? v : JSON.stringify(v), { ...JX, ...o })

const BOOK = '<book id="7"><title>Dune</title><tag>a</tag><tag>b</tag><price currency="USD">9.99</price><zip>02134</zip></book>'

describe('XML → JSON', () => {
  it('default conventions: @_ attributes, #text, repeated → array, values as strings', () => {
    expect(x2v(BOOK)).toEqual({ book: { '@_id': '7', title: 'Dune', tag: ['a', 'b'], price: { '@_currency': 'USD', '#text': '9.99' }, zip: '02134' } })
  })
  it('attribute prefix, grouping and ignoring', () => {
    expect(x2v(BOOK, { attrPrefix: '@' }).book['@id']).toBe('7')
    expect(x2v(BOOK, { attrMode: 'group', attrGroup: '$' }).book).toMatchObject({ $: { id: '7' }, price: { $: { currency: 'USD' }, '#text': '9.99' } })
    expect(x2v(BOOK, { attrMode: 'ignore' }).book).toMatchObject({ price: '9.99' })
  })
  it('custom text key', () => {
    expect(x2v(BOOK, { textKey: '_' }).book.price._).toBe('9.99')
  })
  it('attributes come before children in the output', () => {
    expect(Object.keys(x2v(BOOK).book)[0]).toBe('@_id')
  })
  it('arrays: always, or forced by name/path', () => {
    expect(x2v(BOOK, { arrays: 'always' }).book.title).toEqual(['Dune'])
    expect(x2v('<a><b><c>1</c></b></a>', { forceArrays: 'c' })).toEqual({ a: { b: { c: ['1'] } } })
    expect(x2v('<a><b><c>1</c></b><c>2</c></a>', { forceArrays: 'a.b.c' })).toEqual({ a: { b: { c: ['1'] }, c: '2' } })
  })
  it('parseValues converts numbers/booleans safely', () => {
    expect(x2v('<r a="1"><n>42</n><f>2.5</f><b>true</b><z>02134</z><big>12345678901234567890</big><s>x</s></r>', { parseValues: true })).toEqual({
      r: { '@_a': 1, n: 42, f: 2.5, b: true, z: '02134', big: '12345678901234567890', s: 'x' },
    })
  })
  it('CDATA merged or kept under a key', () => {
    expect(x2v('<a><![CDATA[1 < 2]]></a>')).toEqual({ a: '1 < 2' })
    expect(x2v('<a><![CDATA[1 < 2]]></a>', { cdata: 'key' })).toEqual({ a: { '#cdata': '1 < 2' } })
  })
  it('namespaces are kept as prefixes or stripped', () => {
    const src = '<dc:root xmlns:dc="urn:x"><dc:title>T</dc:title></dc:root>'
    expect(x2v(src)).toEqual({ 'dc:root': { '@_xmlns:dc': 'urn:x', 'dc:title': 'T' } })
    expect(x2v(src, { stripNamespaces: true })).toMatchObject({ root: { title: 'T' } })
  })
  it('comments dropped with a warning, or kept', () => {
    const r = x2j('<a><!-- note --><b>1</b></a>')
    expect(JSON.parse(r.output)).toEqual({ a: { b: '1' } })
    expect(r.warnings[0].message).toMatch(/Comments/)
    expect(x2v('<a><!-- note --><b>1</b></a>', { comments: true }).a['#comment']).toBe(' note ')
  })
  it('entities are decoded, declaration ignored', () => {
    expect(x2v('<?xml version="1.0"?><a t="&quot;q&quot;">&lt;tag&gt; &amp; more</a>')).toEqual({ a: { '@_t': '"q"', '#text': '<tag> & more' } })
  })
  it('mixed content warns', () => {
    const r = x2j('<p>Hello <b>world</b>!</p>')
    expect(r.warnings[0].message).toMatch(/mix text/)
  })
  it('whitespace trimming is configurable', () => {
    expect(x2v('<a>  x  </a>', { trim: false })).toEqual({ a: '  x  ' })
    expect(x2v('<a>  x  </a>')).toEqual({ a: 'x' })
  })
  it('validation errors have line and column', () => {
    const r = x2j('<a>\n  <b></a>')
    expect(r.error).toMatchObject({ line: 2 })
    expect(r.error!.message).toMatch(/closing tag/)
    expect(x2j('<a x=1/>').error?.message).toMatch(/without value|quote/i)
    expect(x2j('not xml').error).toBeDefined()
    expect(x2j('').error?.message).toMatch(/empty/)
  })
  it('does not expand runaway entities', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;"><!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;"><!ENTITY f "&e;&e;&e;&e;&e;&e;&e;&e;&e;&e;">]><l>&f;</l>'
    const r = x2j(bomb)
    expect(r.output.length < 2_000_000 || !!r.error).toBe(true)
  })
})

describe('JSON → XML', () => {
  it('single top-level key becomes the root', () => {
    expect(j2x({ book: { '@_id': 7, title: 'Dune', tag: ['a', 'b'] } }).output).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<book id="7">\n  <title>Dune</title>\n  <tag>a</tag>\n  <tag>b</tag>\n</book>')
  })
  it('multiple top-level keys are wrapped in the root element', () => {
    const r = j2x({ a: 1, b: 2 }, { declaration: false, rootName: 'data' })
    expect(r.output).toBe('<data>\n  <a>1</a>\n  <b>2</b>\n</data>')
    expect(r.meta).toMatch(/wrapped/)
  })
  it('top-level array uses root + item names', () => {
    expect(j2x([{ a: 1 }, { a: 2 }], { declaration: false, indent: 0 }).output).toBe('<root><item><a>1</a></item><item><a>2</a></item></root>')
  })
  it('a single top-level array key is wrapped too (one root only)', () => {
    expect(j2x({ users: [{ n: 1 }, { n: 2 }] }, { declaration: false, indent: 0 }).output).toBe('<root><users><n>1</n></users><users><n>2</n></users></root>')
  })
  it('escapes text and attribute values', () => {
    const r = j2x({ a: { '@_t': 'say "hi" & <bye>', '#text': '1 < 2 & 3 > 2' } }, { declaration: false })
    expect(r.output).toBe('<a t="say &quot;hi&quot; &amp; &lt;bye&gt;">1 &lt; 2 &amp; 3 &gt; 2</a>')
  })
  it('null and empty values: self-closing or explicit', () => {
    expect(j2x({ r: { n: null, e: '' } }, { declaration: false, indent: 0 }).output).toBe('<r><n/><e/></r>')
    expect(j2x({ r: { n: null } }, { declaration: false, indent: 0, selfClose: false }).output).toBe('<r><n></n></r>')
  })
  it('writes numbers exactly as they appear in the JSON', () => {
    expect(j2x('{"r": {"p": 89.00, "e": 1E5, "@_v": 1.50}}', { declaration: false, indent: 0 }).output).toBe('<r v="1.50"><p>89.00</p><e>1E5</e></r>')
  })
  it('keeps big number digits', () => {
    expect(j2x('{"r": {"id": 12345678901234567890}}', { declaration: false, indent: 0 }).output).toBe('<r><id>12345678901234567890</id></r>')
  })
  it('renames invalid element names with a warning', () => {
    const r = j2x({ r: { 'first name': 'Ada', '1st': 'x', ok: 1 } }, { declaration: false, indent: 0 })
    expect(r.output).toBe('<r><first_name>Ada</first_name><_1st>x</_1st><ok>1</ok></r>')
    expect(r.warnings[0].message).toMatch(/not a valid XML name/)
  })
  it('grouped attributes and CDATA key', () => {
    const r = j2x({ a: { $: { id: 1 }, '#cdata': 'x < y' } }, { attrMode: 'group', cdata: 'key', declaration: false, indent: 0 })
    expect(r.output).toBe('<a id="1"><![CDATA[x < y]]></a>')
  })
  it('tab and no indentation', () => {
    expect(j2x({ a: { b: 1 } }, { declaration: false, indent: '\t' }).output).toBe('<a>\n\t<b>1</b>\n</a>')
  })
  it('nested arrays get item wrappers', () => {
    const r = j2x({ m: [[1, 2], [3]] }, { declaration: false, indent: 0 })
    expect(r.output).toBe('<root><m><item>1</item><item>2</item></m><m><item>3</item></m></root>')
    expect(r.warnings.some((w) => /nested array/.test(w.message))).toBe(true)
  })
  it('reports JSON errors', () => {
    expect(j2x('{bad}').error?.line).toBe(1)
  })
  it('output is valid XML for awkward input', () => {
    const r = j2x({ 'weird key!': { '@_bad attr': 'v', 'x:y:z': 1, '': 2 }, other: true })
    expect(r.warnings.every((w) => !/did not pass validation/.test(w.message))).toBe(true)
  })
})

describe('round trip', () => {
  it('XML → JSON → XML preserves structure with default conventions', () => {
    const src = '<catalog><book id="1" lang="en"><title>Dune</title><tag>a</tag><tag>b</tag></book></catalog>'
    const json = x2j(src).output
    const back = j2x(json, { declaration: false, indent: 0 }).output
    expect(back).toBe(src)
  })
  it('JSON → XML → JSON with arrays forced', () => {
    const data = { users: { user: [{ '@_id': '1', name: 'Ada' }, { '@_id': '2', name: 'Bob' }] } }
    const xml = j2x(data).output
    expect(x2v(xml)).toEqual(data)
  })
})

describe('convention validation', () => {
  it('rejects an empty attribute prefix or text key', () => {
    expect(x2j(BOOK, { attrPrefix: '' }).error?.message).toMatch(/prefix/)
    expect(j2x({ a: 1 }, { textKey: '' }).error?.message).toMatch(/text key/)
  })
})

describe('names', () => {
  it('validates and sanitizes', () => {
    expect(isValidXmlName('a-b.c_d')).toBe(true)
    expect(isValidXmlName('ns:tag')).toBe(true)
    expect(isValidXmlName('1a')).toBe(false)
    expect(isValidXmlName('café')).toBe(true)
    expect(sanitizeXmlName('a b')).toBe('a_b')
    expect(sanitizeXmlName('')).toBe('_')
    expect(isValidXmlName(sanitizeXmlName('a:b:c'))).toBe(true)
    expect(isValidXmlName(sanitizeXmlName('::'))).toBe(true)
  })
})

describe('conventions example', () => {
  it('is generated from the engine for the current options', () => {
    const a = JSON.parse(conventionExample(XJ).json)
    expect(a.book['@_id']).toBe('7')
    expect(a.book.tag).toEqual(['sci-fi', 'classic'])
    const b = JSON.parse(conventionExample({ ...XJ, attrMode: 'group', parseValues: true, cdata: 'key' }).json)
    expect(b.book.$.id).toBe(7)
    expect(b.book.isbn).toBe('0441013597')
    expect(b.book.note).toEqual({ '#cdata': 'Spice < water' })
  })
})

describe('large input', () => {
  it('converts 20k elements both ways', () => {
    const items = Array.from({ length: 20_000 }, (_, i) => `<item id="${i}"><name>n${i}</name><v>${i}</v></item>`).join('')
    const r = x2j(`<items>${items}</items>`)
    const v = JSON.parse(r.output)
    expect(v.items.item).toHaveLength(20_000)
    const back = j2x(r.output, { indent: 0, declaration: false })
    expect(back.output.length).toBeGreaterThan(items.length)
  })
})
