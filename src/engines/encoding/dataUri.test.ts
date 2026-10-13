import { describe, expect, it } from 'vitest'
import { buildDataUri, dataUriSizes, isImageMime, isTextMime, mimeFromName, parseDataUri, percentDecodeToBytes, percentEncodeBytes } from './dataUri'

const te = new TextEncoder()
const td = new TextDecoder()

describe('parseDataUri', () => {
  it('parses base64 data with parameters', () => {
    const r = parseDataUri('data:image/png;name=dot.png;base64,iVBORw0KGgo=')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toMatchObject({ mime: 'image/png', mimeExplicit: true, base64: true, params: [{ name: 'name', value: 'dot.png' }] })
    expect(Array.from(r.value.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  })
  it('defaults to text/plain;charset=US-ASCII', () => {
    const r = parseDataUri('data:,Hello%2C%20World')
    expect(r.ok && r.value).toMatchObject({ mime: 'text/plain', mimeExplicit: false, charset: 'US-ASCII', base64: false })
    expect(r.ok && td.decode(r.value.bytes)).toBe('Hello, World')
  })
  it('decodes percent-encoded UTF-8 and quoted parameters', () => {
    const r = parseDataUri('DATA:text/html;charset="utf-8",%3Ch1%3Ecaf%C3%A9%3C%2Fh1%3E')
    expect(r.ok && r.value.charset).toBe('utf-8')
    expect(r.ok && td.decode(r.value.bytes)).toBe('<h1>café</h1>')
  })
  it('tolerates whitespace in base64', () => {
    const r = parseDataUri('data:text/plain;base64,SGVs\n bG8=')
    expect(r.ok && td.decode(r.value.bytes)).toBe('Hello')
  })
  it('reports malformed URIs', () => {
    const cases: [string, RegExp][] = [
      ['', /Paste/],
      ['image/png;base64,AAAA', /must start with "data:"/],
      ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', /bare Base64/],
      ['data:text/plain;base64', /Missing ","/],
      ['data:text/plain;base64,SGV$bG8=', /not valid Base64/],
      ['data:image;base64,AAAA', /not a valid media type/],
      ['data:text/plain;base64;charset=utf-8,AAAA', /must be the last parameter/],
      ['data:text/plain;charset,AAAA', /has no value/],
    ]
    for (const [input, re] of cases) {
      const r = parseDataUri(input)
      expect(r.ok, input).toBe(false)
      if (!r.ok) expect(r.error.message).toMatch(re)
    }
  })
  it('warns about fragments, raw whitespace and bad escapes', () => {
    const r = parseDataUri('data:text/plain,a b#c %ZZ')
    expect(r.ok && r.value.warnings).toHaveLength(3)
  })
})

describe('building', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#0f766e"/></svg>'
  it('round-trips base64 and percent encodings', () => {
    for (const encoding of ['base64', 'percent'] as const) {
      const uri = buildDataUri(te.encode(svg), { mime: 'image/svg+xml', encoding })
      const r = parseDataUri(uri)
      expect(r.ok && td.decode(r.value.bytes)).toBe(svg)
      expect(r.ok && r.value.mime).toBe('image/svg+xml')
    }
  })
  it('percent encoding escapes characters unsafe in HTML/CSS', () => {
    const enc = percentEncodeBytes(te.encode('a"b#c<d> é\'()%{|}'))
    expect(enc).toBe('a%22b%23c<d>%20%C3%A9%27()%25%7B%7C%7D')
  })
  it('computes exact sizes for both encodings', () => {
    const bytes = te.encode(svg)
    const opts = { mime: 'image/svg+xml', charset: 'utf-8' }
    const sizes = dataUriSizes(bytes, opts)
    expect(sizes.base64).toBe(buildDataUri(bytes, { ...opts, encoding: 'base64' }).length)
    expect(sizes.percent).toBe(buildDataUri(bytes, { ...opts, encoding: 'percent' }).length)
    expect(sizes.percent).toBeLessThan(sizes.base64)
    const binary = crypto.getRandomValues(new Uint8Array(3000))
    const s2 = dataUriSizes(binary, { mime: 'application/octet-stream' })
    expect(s2.base64).toBeLessThan(s2.percent)
  })
  it('percent-decodes to raw bytes', () => {
    expect(Array.from(percentDecodeToBytes('%FFa').bytes)).toEqual([0xff, 0x61])
    expect(percentDecodeToBytes('%G1').badEscapes).toEqual([0])
  })
  it('handles a large payload', () => {
    const bytes = new Uint8Array(2 * 1024 * 1024).map((_, i) => (i * 2654435761) >>> 24)
    const r = parseDataUri(buildDataUri(bytes, { mime: 'application/octet-stream', encoding: 'base64' }))
    expect(r.ok && Buffer.compare(r.value.bytes, bytes)).toBe(0)
  })
})

describe('mime helpers', () => {
  it('classifies types', () => {
    expect(isTextMime('application/json')).toBe(true)
    expect(isTextMime('image/svg+xml')).toBe(true)
    expect(isTextMime('image/png')).toBe(false)
    expect(isImageMime('image/svg+xml')).toBe(true)
    expect(isImageMime('image/tiff')).toBe(false)
    expect(mimeFromName('logo.SVG')).toBe('image/svg+xml')
    expect(mimeFromName('README')).toBeNull()
  })
})
