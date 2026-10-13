import { describe, expect, it } from 'vitest'
import { analyzeSvg, cssBackgroundSnippet, jsxAttrName, styleToJsx, svgToBase64DataUri, svgToJsx, svgToMiniDataUri } from './svg'
import { DEFAULT_SVGO, optimizeSvg, prettifySvg } from './svgo'
import { base64ToBytes } from '@/engines/encoding/base64'

const ICON = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Sketch -->
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0f766e" stroke-width="2.000" stroke-linecap="round">
  <title>Check</title>
  <g>
    <path d="M 20.000 6.000 L 9.000 17.000 L 4.000 12.000"/>
  </g>
</svg>`

describe('analyzeSvg', () => {
  it('reads size, viewBox and element counts', () => {
    const r = analyzeSvg(ICON)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.info).toMatchObject({ width: '24', height: '24', viewBox: '0 0 24 24', intrinsic: { width: 24, height: 24 }, elementCount: 4, issues: [] })
    expect(r.info.elements[0][1]).toBe(1)
  })
  it('derives intrinsic size from the viewBox', () => {
    const r = analyzeSvg('<svg viewBox="0 0 200 100" width="400"></svg>')
    expect(r.ok && r.info.intrinsic).toEqual({ width: 400, height: 200 })
    const r2 = analyzeSvg('<svg viewBox="0,0,50,20"></svg>')
    expect(r2.ok && r2.info.intrinsic).toEqual({ width: 50, height: 20 })
    const r3 = analyzeSvg('<svg width="100%"></svg>')
    expect(r3.ok && r3.info.intrinsic).toEqual({ width: 300, height: 150 })
  })
  it('detects scripts, handlers, javascript: URLs, external references and imports', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
  <script>alert(2)</script>
  <a href="javascript:alert(3)"><text>x</text></a>
  <image href="https://tracker.example/pixel.png"/>
  <use xlink:href="sprite.svg#icon"/>
  <use href="#local"/>
  <image href="data:image/png;base64,AAAA"/>
  <style>@import url(https://fonts.example/x.css); .a{fill:url(#g)}</style>
  <rect style="fill: url(http://evil.example/p.svg)"/>
  <foreignObject><div>html</div></foreignObject>
</svg>`
    const r = analyzeSvg(svg)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const kinds = r.info.issues.map((i) => i.kind)
    expect(kinds).toEqual(['event-handler', 'script', 'javascript-url', 'external-ref', 'external-ref', 'css-import', 'external-ref', 'external-ref', 'foreign-object'])
    expect(r.info.issues[1]).toMatchObject({ line: 2, column: 3 })
  })
  it('rejects non-SVG and malformed markup with a location', () => {
    expect(analyzeSvg('<div></div>')).toMatchObject({ ok: false, error: { message: 'The root element is <div>, not <svg>' } })
    expect(analyzeSvg('hello')).toMatchObject({ ok: false, error: { message: 'No <svg> element found' } })
    expect(analyzeSvg('<svg>\n<path d="M0 0></svg>')).toMatchObject({ ok: false, error: { line: 2 } })
  })
})

describe('data URIs', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <circle cx="5" cy="5" r="4" fill="#0f766e"/>\n  <text>100% café &amp; "東京"</text>\n</svg>`
  it('base64-encodes the UTF-8 bytes', () => {
    const uri = svgToBase64DataUri(svg)
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const bytes = base64ToBytes(uri.slice('data:image/svg+xml;base64,'.length))
    expect(new TextDecoder().decode(bytes)).toBe(svg)
  })
  it('produces a compact URL-encoded form that decodes back to the (whitespace-collapsed) SVG', () => {
    const uri = svgToMiniDataUri(svg)
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true)
    const payload = uri.slice('data:image/svg+xml,'.length)
    // Must be safe inside url("…") and double-quoted HTML attributes.
    expect(payload).not.toMatch(/["#<>\n]/)
    expect(payload).toContain("xmlns='http://www.w3.org/2000/svg'")
    expect(payload).toContain('%23') // # of the color
    expect(payload).toContain('%25') // % in text
    expect(decodeURIComponent(payload)).toBe(svg.trim().replace(/\s+/g, ' ').replace(/"/g, "'"))
  })
  it('keeps double quotes (encoded) when the SVG already contains single quotes', () => {
    const s = `<svg xmlns="http://www.w3.org/2000/svg"><text font-family="'Inter', sans-serif">it's</text></svg>`
    const payload = svgToMiniDataUri(s).slice('data:image/svg+xml,'.length)
    expect(payload).toContain('%22')
    expect(payload).not.toContain('"')
    expect(decodeURIComponent(payload)).toBe(s)
  })
  it('does not collapse whitespace when xml:space="preserve" is used', () => {
    const s = '<svg><text xml:space="preserve">a   b</text></svg>'
    expect(decodeURIComponent(svgToMiniDataUri(s).slice(19))).toBe(s.replace(/"/g, "'"))
  })
  it('strips a BOM and survives lone surrogates', () => {
    expect(svgToMiniDataUri('﻿<svg/>')).toBe("data:image/svg+xml,%3csvg/%3e")
    expect(svgToMiniDataUri('<svg>\uD800</svg>')).toContain('%ef%bf%bd')
  })
  it('wraps into a CSS background snippet', () => {
    expect(cssBackgroundSnippet('data:image/svg+xml,x')).toBe('background-image: url("data:image/svg+xml,x");')
  })
})

describe('svgToJsx', () => {
  it('camelCases attributes and converts style', () => {
    expect(jsxAttrName('stroke-width')).toBe('strokeWidth')
    expect(jsxAttrName('class')).toBe('className')
    expect(jsxAttrName('xlink:href')).toBe('xlinkHref')
    expect(jsxAttrName('data-name')).toBe('data-name')
    expect(jsxAttrName('aria-hidden')).toBe('aria-hidden')
    expect(jsxAttrName('viewBox')).toBe('viewBox')
    expect(styleToJsx('fill: red; stroke-width: 2; --x: 1')).toBe("{{ fill: 'red', strokeWidth: '2', '--x': '1' }}")
  })
  it('converts a whole document', () => {
    const jsx = svgToJsx('<?xml version="1.0"?><!-- c --><svg class="i" stroke-width="2" style="opacity:.5"><path fill-rule="evenodd" d="M0 0"/><text>{x}</text></svg>')
    expect(jsx).toBe(`{/* c */}<svg className="i" strokeWidth="2" style={{ opacity: '.5' }}><path fillRule="evenodd" d="M0 0" /><text>{'{'}x{'}'}</text></svg>`)
  })
})

describe('svgo', () => {
  it('optimizes and keeps the viewBox by default', () => {
    const r = optimizeSvg(ICON)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.length).toBeLessThan(ICON.length)
    expect(r.data).toContain('viewBox="0 0 24 24"')
    expect(r.data).not.toContain('Sketch')
    expect(r.data).toContain('<title>')
  })
  it('honours plugin toggles', () => {
    const r = optimizeSvg(ICON, { ...DEFAULT_SVGO, removeViewBox: true, removeTitle: true, removeDimensions: false })
    expect(r.ok && r.data).not.toContain('viewBox')
    expect(r.ok && r.data).not.toContain('<title>')
    const d = optimizeSvg(ICON, { ...DEFAULT_SVGO, removeDimensions: true })
    expect(d.ok && d.data).not.toMatch(/width="24"/)
    const s = optimizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onclick="x()" width="1" height="1"/></svg>', { ...DEFAULT_SVGO, removeScripts: true })
    expect(s.ok && s.data).not.toMatch(/script|onclick/)
  })
  it('pretty-prints with indentation', () => {
    const r = optimizeSvg(ICON, { ...DEFAULT_SVGO, pretty: true, indent: 4 })
    expect(r.ok && r.data).toMatch(/\n {4}</)
    const p = prettifySvg('<svg><g><rect/></g></svg>', 2)
    expect(p).toEqual({ ok: true, data: '<svg>\n  <g>\n    <rect/>\n  </g>\n</svg>\n' })
  })
  it('reports parse errors with location', () => {
    expect(optimizeSvg('<svg><rect></svg>')).toMatchObject({ ok: false, error: { line: 1, column: 17 } })
  })
})
