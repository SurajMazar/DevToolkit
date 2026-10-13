import { bytesToBase64 } from '@/engines/encoding/base64'
import { offsetToLineColumn, tokenizeHtml, XML_RAW_TEXT, type HtmlToken } from './tokenizer'

export type SvgIssueKind = 'script' | 'event-handler' | 'external-ref' | 'javascript-url' | 'foreign-object' | 'embedded-content' | 'css-import'

export interface SvgIssue {
  kind: SvgIssueKind
  message: string
  line: number
  column: number
}

export interface SvgInfo {
  width: string | null
  height: string | null
  viewBox: string | null
  /** Intrinsic size used for previews (from width/height, else viewBox, else 300×150). */
  intrinsic: { width: number; height: number }
  elementCount: number
  /** Element names with counts, most frequent first. */
  elements: [string, number][]
  issues: SvgIssue[]
}

export type AnalyzeSvgResult = { ok: true; info: SvgInfo } | { ok: false; error: { message: string; line?: number; column?: number } }

const ABS_LENGTH = /^\s*([\d.]+)\s*(px)?\s*$/i

function numericLength(v: string | null): number | null {
  if (!v) return null
  const m = ABS_LENGTH.exec(v)
  return m ? Number(m[1]) : null
}

function isExternalRef(value: string): boolean {
  const v = value.trim()
  if (!v || v.startsWith('#')) return false
  if (/^data:/i.test(v)) return false
  return true
}

/**
 * Inspects SVG markup without rendering it: size, viewBox, element counts, and anything
 * that could run code or load resources (scripts, on* handlers, external hrefs, CSS imports).
 */
export function analyzeSvg(markup: string): AnalyzeSvgResult {
  const { tokens, errors } = tokenizeHtml(markup, { rawTextElements: XML_RAW_TEXT })
  if (errors.length) return { ok: false, error: errors[0] }
  const root = tokens.find((t): t is Extract<HtmlToken, { type: 'startTag' }> => t.type === 'startTag')
  if (!root || root.lname !== 'svg') return { ok: false, error: { message: root ? `The root element is <${root.name}>, not <svg>` : 'No <svg> element found' } }
  const attr = (t: Extract<HtmlToken, { type: 'startTag' }>, name: string) => t.attrs.find((a) => a.name.toLowerCase() === name.toLowerCase())?.value ?? null
  const issues: SvgIssue[] = []
  const at = (offset: number) => offsetToLineColumn(markup, offset)
  const counts = new Map<string, number>()
  let elementCount = 0
  let inStyle = false
  for (const t of tokens) {
    if (t.type === 'startTag') {
      elementCount++
      counts.set(t.name, (counts.get(t.name) ?? 0) + 1)
      if (t.lname === 'script') issues.push({ kind: 'script', message: '<script> element', ...at(t.start) })
      if (t.lname === 'foreignobject') issues.push({ kind: 'foreign-object', message: '<foreignObject> can embed arbitrary HTML', ...at(t.start) })
      if (['iframe', 'embed', 'object'].includes(t.lname)) issues.push({ kind: 'embedded-content', message: `<${t.name}> embeds external content`, ...at(t.start) })
      inStyle = t.lname === 'style' && !t.selfClosing
      for (const a of t.attrs) {
        const name = a.name.toLowerCase()
        const value = a.value ?? ''
        if (/^on/.test(name)) issues.push({ kind: 'event-handler', message: `${a.name}="…" event handler on <${t.name}>`, ...at(a.start) })
        else if (/^\s*javascript:/i.test(value)) issues.push({ kind: 'javascript-url', message: `javascript: URL in ${a.name} on <${t.name}>`, ...at(a.start) })
        else if ((name === 'href' || name === 'xlink:href' || name === 'src') && isExternalRef(value))
          issues.push({ kind: 'external-ref', message: `External reference ${a.name}="${value.length > 48 ? value.slice(0, 48) + '…' : value}" on <${t.name}>`, ...at(a.start) })
        else if (name === 'style' && /url\(\s*['"]?\s*(?!#|data:)[^)'"\s]/i.test(value))
          issues.push({ kind: 'external-ref', message: `External url() in style attribute on <${t.name}>`, ...at(a.start) })
      }
    } else if (t.type === 'endTag') {
      if (t.lname === 'style') inStyle = false
    } else if (t.type === 'rawText' && (t.parent === 'style' || inStyle)) {
      if (/@import\b/i.test(t.value)) issues.push({ kind: 'css-import', message: '@import in <style> loads an external stylesheet', ...at(t.start) })
      if (/url\(\s*['"]?\s*(?!#|data:)[^)'"\s]/i.test(t.value)) issues.push({ kind: 'external-ref', message: 'External url() in <style>', ...at(t.start) })
    }
  }
  const width = attr(root, 'width')
  const height = attr(root, 'height')
  const viewBox = attr(root, 'viewBox')
  const vb = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const vbOk = vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0
  let w = numericLength(width)
  let h = numericLength(height)
  if (vbOk) {
    if (w == null && h == null) {
      w = vb![2]
      h = vb![3]
    } else if (w == null) w = (h! * vb![2]) / vb![3]
    else if (h == null) h = (w * vb![3]) / vb![2]
  }
  return {
    ok: true,
    info: {
      width,
      height,
      viewBox,
      intrinsic: { width: w ?? 300, height: h ?? 150 },
      elementCount,
      elements: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      issues,
    },
  }
}

/** `data:image/svg+xml;base64,…` of the UTF-8 bytes. */
export function svgToBase64DataUri(svg: string): string {
  return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`
}

/**
 * Compact URL-encoded data URI (the "mini-svg-data-uri" technique): whitespace collapsed,
 * double quotes swapped for single quotes when that is unambiguous, and only the
 * characters that must be escaped are percent-encoded. Safe inside `url("…")` and in
 * double-quoted HTML attributes.
 */
export function svgToMiniDataUri(svg: string): string {
  let s = svg.charCodeAt(0) === 0xfeff ? svg.slice(1) : svg
  // Whitespace is only insignificant when nothing asks for it to be preserved.
  if (!/xml:space\s*=\s*["']preserve|white-space\s*:/i.test(s)) s = s.trim().replace(/\s+/g, ' ')
  // Swapping quotes is only safe when the document has no single quotes of its own.
  if (!s.includes("'")) s = s.replace(/"/g, "'")
  let encoded: string
  try {
    encoded = encodeURIComponent(s)
  } catch {
    encoded = encodeURIComponent(s.replace(/[\uD800-\uDFFF]/g, '�'))
  }
  const payload = encoded.replace(/%[\dA-F]{2}/g, (m) => {
    switch (m) {
      case '%20':
        return ' '
      case '%3D':
        return '='
      case '%3A':
        return ':'
      case '%2F':
        return '/'
      default:
        return m.toLowerCase()
    }
  })
  return `data:image/svg+xml,${payload}`
}

export function cssBackgroundSnippet(dataUri: string): string {
  return `background-image: url("${dataUri}");`
}

const JSX_ATTR_EXCEPTIONS: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  'xlink:href': 'xlinkHref',
  'xlink:title': 'xlinkTitle',
  'xlink:actuate': 'xlinkActuate',
  'xlink:arcrole': 'xlinkArcrole',
  'xlink:role': 'xlinkRole',
  'xlink:show': 'xlinkShow',
  'xlink:type': 'xlinkType',
  'xml:space': 'xmlSpace',
  'xml:lang': 'xmlLang',
  'xml:base': 'xmlBase',
  'xmlns:xlink': 'xmlnsXlink',
}

/** SVG attribute name → React prop name (`stroke-width` → `strokeWidth`). */
export function jsxAttrName(name: string): string {
  const lower = name.toLowerCase()
  if (JSX_ATTR_EXCEPTIONS[lower]) return JSX_ATTR_EXCEPTIONS[lower]
  if (/^(data|aria)-/.test(lower)) return name
  if (name.includes(':')) return name.replace(/:([a-z])/g, (_, c: string) => c.toUpperCase())
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

function jsString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

/** `fill: red; stroke-width: 2` → `{{ fill: 'red', strokeWidth: '2' }}` */
export function styleToJsx(style: string): string {
  const entries = style
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':')
      if (i === -1) return null
      const prop = d.slice(0, i).trim()
      const value = d.slice(i + 1).trim()
      const key = prop.startsWith('--') ? jsString(prop) : prop.replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
      return `${key}: ${jsString(value)}`
    })
    .filter(Boolean)
  return `{{ ${entries.join(', ')} }}`
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|quot|amp|apos|lt|gt);/gi, (m, e: string) => {
    const k = e.toLowerCase()
    if (k === 'quot') return '"'
    if (k === 'amp') return '&'
    if (k === 'apos') return "'"
    if (k === 'lt') return '<'
    if (k === 'gt') return '>'
    const cp = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
    return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m
  })
}

/**
 * Converts SVG markup to JSX: camelCased attributes, `style` objects, comments as
 * `{/* *\/}`, braces in text escaped. The XML declaration and doctype are dropped.
 */
export function svgToJsx(svg: string): string {
  const { tokens, errors } = tokenizeHtml(svg, { rawTextElements: XML_RAW_TEXT })
  if (errors.length) throw new Error(errors[0].message)
  let out = ''
  for (const t of tokens) {
    switch (t.type) {
      case 'pi':
      case 'doctype':
        break
      case 'comment':
        out += `{/*${t.value.replace(/\*\//g, '* /')}*/}`
        break
      case 'cdata':
      case 'rawText':
        out += `{${JSON.stringify(t.value)}}`
        break
      case 'text':
        out += t.value.replace(/[{}]/g, (c) => `{'${c}'}`)
        break
      case 'endTag':
        out += `</${t.name}>`
        break
      case 'startTag': {
        let s = `<${t.name}`
        for (const a of t.attrs) {
          const name = jsxAttrName(a.name)
          if (a.value === null) s += ` ${name}`
          else if (a.name.toLowerCase() === 'style') s += ` style=${styleToJsx(decodeEntities(a.value))}`
          else {
            const v = decodeEntities(a.value)
            s += v.includes('"') ? ` ${name}={${jsString(v)}}` : ` ${name}="${v}"`
          }
        }
        out += s + (t.selfClosing ? ' />' : '>')
        break
      }
    }
  }
  return out.trim()
}
