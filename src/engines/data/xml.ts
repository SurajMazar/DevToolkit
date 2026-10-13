/**
 * JSON ⇄ XML with fast-xml-parser. XML and JSON don't map 1:1, so every convention is an
 * explicit option:
 *
 * - Attributes: prefixed keys (`"@_id": "7"`), grouped under one key (`"$": {"id": "7"}`),
 *   or ignored.
 * - Text of an element that also has attributes or children: `textKey` (`#text`).
 * - Repeated sibling elements become arrays. A single element is a plain value unless
 *   "always arrays" is on or its name/path is listed in `forceArrays`.
 * - Values stay strings unless `parseValues` is on — `<zip>02134</zip>` and
 *   `<id>12345678901234567890</id>` would otherwise be damaged.
 * - CDATA merges into the text or is kept under `cdataKey` (`#cdata`).
 * - Namespace prefixes are kept as part of names (`dc:title`) unless stripped.
 * - Mixed content (text interleaved with child elements) can't keep its order in JSON:
 *   text segments are joined under `textKey`.
 * - The XML declaration and processing instructions are not part of the JSON.
 *
 * Parsing never executes anything and does not use the DOM. Entity expansion is bounded
 * by fast-xml-parser's limits.
 */
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import { isLosslessNumber } from '@/engines/json/parse'
import { parseJsonKeepNumbers } from './json-text'
import { stringifyJson } from '@/engines/json/stringify'
import { looksNumeric } from './csv'
import type { ConvertIssue, ConvertResult } from './yaml'

export type AttrMode = 'prefix' | 'group' | 'ignore'

export interface XmlConventions {
  attrMode: AttrMode
  attrPrefix: string
  attrGroup: string
  textKey: string
  cdata: 'merge' | 'key'
  cdataKey: string
  /** Keep comments under `#comment`. */
  comments: boolean
}

export interface XmlToJsonOptions extends XmlConventions {
  arrays: 'auto' | 'always'
  /** Element names (any depth) or dotted paths (`catalog.book.author`) that are always arrays. */
  forceArrays: string
  parseValues: boolean
  trim: boolean
  stripNamespaces: boolean
  indent: number | '\t'
}

export interface JsonToXmlOptions extends XmlConventions {
  declaration: boolean
  /** 0 = single line. */
  indent: number | '\t'
  /** Used when the JSON has no single top-level key. */
  rootName: string
  /** Element name for array items without a key (top-level arrays, nested arrays). */
  itemName: string
  /** `<a/>` instead of `<a></a>` for empty values. */
  selfClose: boolean
}

export const COMMENT_KEY = '#comment'

export const DEFAULT_CONVENTIONS: XmlConventions = {
  attrMode: 'prefix',
  attrPrefix: '@_',
  attrGroup: '$',
  textKey: '#text',
  cdata: 'merge',
  cdataKey: '#cdata',
  comments: false,
}

export const DEFAULT_XML_TO_JSON: XmlToJsonOptions = { ...DEFAULT_CONVENTIONS, arrays: 'auto', forceArrays: '', parseValues: false, trim: true, stripNamespaces: false, indent: 2 }

export const DEFAULT_JSON_TO_XML: JsonToXmlOptions = { ...DEFAULT_CONVENTIONS, declaration: true, indent: 2, rootName: 'root', itemName: 'item', selfClose: true }

const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`

/** Converts element/attribute text to a number or boolean (same rules as CSV → JSON). */
function typedValue(v: string): unknown {
  if (v === 'true') return true
  if (v === 'false') return false
  return looksNumeric(v) ? Number(v) : v
}

function forcedMatcher(spec: string) {
  const entries = spec
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const names = new Set(entries.filter((e) => !e.includes('.')))
  const paths = new Set(entries.filter((e) => e.includes('.')))
  return (name: string, path: string) => names.has(name) || paths.has(path)
}

function validationError(text: string): ConvertIssue | null {
  const v = XMLValidator.validate(text, { allowBooleanAttributes: true })
  if (v === true) return null
  return { message: v.err.msg, line: v.err.line, column: v.err.col }
}

function isAttrKey(k: string, o: XmlConventions) {
  return o.attrMode === 'prefix' ? o.attrPrefix !== '' && k.startsWith(o.attrPrefix) : o.attrMode === 'group' ? k === o.attrGroup : false
}

/** Puts attributes first and counts mixed-content elements. */
function tidy(v: unknown, o: XmlToJsonOptions, stats: { mixed: number }): unknown {
  if (Array.isArray(v)) return v.map((x) => tidy(x, o, stats))
  if (!v || typeof v !== 'object') return v
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj)
  const attrs = keys.filter((k) => isAttrKey(k, o))
  const rest = keys.filter((k) => !isAttrKey(k, o))
  const hasText = rest.includes(o.textKey)
  if (hasText && rest.some((k) => k !== o.textKey && k !== COMMENT_KEY && k !== o.cdataKey)) stats.mixed++
  const out: Record<string, unknown> = {}
  for (const k of attrs) out[k] = obj[k]
  for (const k of rest) out[k] = tidy(obj[k], o, stats)
  return out
}

function conventionError(o: XmlConventions): ConvertIssue | null {
  if (o.attrMode === 'prefix' && !o.attrPrefix) return { message: 'The attribute prefix can’t be empty — attributes would collide with child elements. Use e.g. @_ or group attributes instead.' }
  if (o.attrMode === 'group' && !o.attrGroup) return { message: 'The attributes object key can’t be empty.' }
  if (!o.textKey) return { message: 'The text key can’t be empty.' }
  return null
}

export function xmlToJson(text: string, opts: XmlToJsonOptions = DEFAULT_XML_TO_JSON): ConvertResult {
  if (!text.trim()) return { output: '', error: { message: 'Input is empty' }, warnings: [] }
  const bad = conventionError(opts)
  if (bad) return { output: '', error: bad, warnings: [] }
  const invalid = validationError(text)
  if (invalid) return { output: '', error: invalid, warnings: [] }
  const forced = forcedMatcher(opts.forceArrays)
  const parser = new XMLParser({
    ignoreAttributes: opts.attrMode === 'ignore',
    attributeNamePrefix: opts.attrMode === 'prefix' ? opts.attrPrefix : '',
    attributesGroupName: opts.attrMode === 'group' ? opts.attrGroup || '$' : false,
    textNodeName: opts.textKey || '#text',
    allowBooleanAttributes: true,
    parseTagValue: false,
    parseAttributeValue: false,
    ...(opts.parseValues ? { tagValueProcessor: (_n: string, v: string) => typedValue(v), attributeValueProcessor: (_n: string, v: string) => typedValue(v) } : {}),
    trimValues: opts.trim,
    cdataPropName: opts.cdata === 'key' ? opts.cdataKey || '#cdata' : false,
    commentPropName: opts.comments ? COMMENT_KEY : false,
    removeNSPrefix: opts.stripNamespaces,
    ignoreDeclaration: true,
    ignorePiTags: true,
    processEntities: true,
    htmlEntities: false,
    isArray: (name, jpath, _leaf, isAttribute) => {
      if (isAttribute) return false
      const path = String(jpath)
      if (opts.arrays === 'always') return path.includes('.')
      return forced(name, path)
    },
  })
  let value: unknown
  try {
    value = parser.parse(text)
  } catch (e) {
    return { output: '', error: { message: e instanceof Error ? e.message : String(e) }, warnings: [] }
  }
  const stats = { mixed: 0 }
  value = tidy(value, opts, stats)
  const warnings: ConvertIssue[] = []
  if (stats.mixed) warnings.push({ message: `${plural(stats.mixed, 'element')} mix text with child elements — the text pieces were joined under “${opts.textKey}” and their position between children is lost.` })
  if (/<\?xml-stylesheet|<\?[a-zA-Z]/.test(text.replace(/^\s*<\?xml[^>]*\?>/, ''))) warnings.push({ message: 'Processing instructions (<?…?>) are not part of the JSON output.' })
  if (!opts.comments && /<!--/.test(text)) warnings.push({ message: 'Comments are dropped. Turn on “Keep comments” to keep them under “#comment”.' })
  return { output: stringifyJson(value, { indent: opts.indent === 0 ? '' : opts.indent }), warnings }
}

// ── JSON → XML ───────────────────────────────────────────────────────────────

const RE_NAME = /^[\p{L}_][\p{L}\p{N}_.\-]*(?::[\p{L}_][\p{L}\p{N}_.\-]*)?$/u

export function isValidXmlName(n: string) {
  return RE_NAME.test(n)
}

export function sanitizeXmlName(n: string): string {
  if (isValidXmlName(n)) return n
  let s = n.replace(/[^\p{L}\p{N}_.\-:]/gu, '_').replace(/:(?=.*:)/g, '_')
  if (!/^[\p{L}_]/u.test(s)) s = `_${s}`
  if (s.endsWith(':')) s = `${s}_`
  return isValidXmlName(s) ? s : `_${s.replace(/:/g, '_')}`
}

interface PrepCtx {
  o: JsonToXmlOptions
  renamed: Map<string, string>
  nestedArrays: number
  objectAttrs: number
}

/** Prepares JSON for the builder: digits for big numbers, valid names, nulls as empty text. */
function prep(v: unknown, ctx: PrepCtx): unknown {
  if (v === null || v === undefined) return ''
  if (isLosslessNumber(v)) return (v as { value: string }).value
  if (typeof v !== 'object') return v
  if (Array.isArray(v)) {
    return v.map((x) => {
      if (Array.isArray(x)) {
        ctx.nestedArrays++
        return { [ctx.o.itemName]: prep(x, ctx) }
      }
      return prep(x, ctx)
    })
  }
  const { o } = ctx
  const obj = v as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const rename = (k: string) => {
    const s = sanitizeXmlName(k)
    if (s !== k) ctx.renamed.set(k, s)
    let name = s
    let n = 2
    while (Object.prototype.hasOwnProperty.call(out, name)) name = `${s}_${n++}`
    return name
  }
  const attrValue = (x: unknown) => {
    if (x === null || x === undefined) return ''
    if (isLosslessNumber(x)) return (x as { value: string }).value
    if (typeof x === 'object') {
      ctx.objectAttrs++
      return stringifyJson(x)
    }
    return x
  }
  for (const k of Object.keys(obj)) {
    const val = obj[k]
    if (k === o.textKey || (o.cdata === 'key' && k === o.cdataKey) || (o.comments && k === COMMENT_KEY)) {
      out[k] = val === null ? '' : isLosslessNumber(val) ? (val as { value: string }).value : val
    } else if (o.attrMode === 'prefix' && o.attrPrefix && k.startsWith(o.attrPrefix)) {
      const name = k.slice(o.attrPrefix.length)
      const s = sanitizeXmlName(name)
      if (s !== name) ctx.renamed.set(name, s)
      out[o.attrPrefix + s] = attrValue(val)
    } else if (o.attrMode === 'group' && k === o.attrGroup && val && typeof val === 'object' && !Array.isArray(val)) {
      const attrs: Record<string, unknown> = {}
      for (const [an, av] of Object.entries(val as Record<string, unknown>)) {
        const s = sanitizeXmlName(an)
        if (s !== an) ctx.renamed.set(an, s)
        attrs[s] = attrValue(av)
      }
      out[k] = attrs
    } else {
      out[rename(k)] = prep(val, ctx)
    }
  }
  return out
}

function isSpecialKey(k: string, o: XmlConventions) {
  return isAttrKey(k, o) || k === o.textKey || k === o.cdataKey || k === COMMENT_KEY
}

export function jsonToXml(text: string, opts: JsonToXmlOptions = DEFAULT_JSON_TO_XML): ConvertResult {
  const parsed = parseJsonKeepNumbers(text)
  if (!parsed.ok) return { output: '', error: parsed.error, warnings: [] }
  const bad = conventionError(opts)
  if (bad) return { output: '', error: bad, warnings: [] }
  const rootName = sanitizeXmlName(opts.rootName.trim() || 'root')
  const itemName = sanitizeXmlName(opts.itemName.trim() || 'item')
  const o = { ...opts, rootName, itemName }
  const ctx: PrepCtx = { o, renamed: new Map(), nestedArrays: 0, objectAttrs: 0 }
  const v = parsed.value
  let doc: Record<string, unknown>
  let meta: string | undefined
  const isObj = v !== null && typeof v === 'object' && !Array.isArray(v) && !isLosslessNumber(v)
  const keys = isObj ? Object.keys(v as object) : []
  if (isObj && keys.length === 1 && !isSpecialKey(keys[0], o) && !Array.isArray((v as Record<string, unknown>)[keys[0]])) {
    doc = prep(v, ctx) as Record<string, unknown>
  } else if (Array.isArray(v)) {
    doc = { [rootName]: { [itemName]: prep(v, ctx) } }
    meta = `array wrapped in <${rootName}>, items as <${itemName}>`
  } else {
    doc = { [rootName]: prep(v, ctx) }
    meta = isObj ? (keys.length === 0 ? `empty object → <${rootName}/>` : `wrapped in <${rootName}>`) : `value wrapped in <${rootName}>`
  }
  const indentBy = opts.indent === '\t' ? '\t' : ' '.repeat(typeof opts.indent === 'number' ? opts.indent : 2)
  const builder = new XMLBuilder({
    ignoreAttributes: opts.attrMode === 'ignore',
    attributeNamePrefix: opts.attrMode === 'prefix' ? opts.attrPrefix : '',
    attributesGroupName: opts.attrMode === 'group' ? opts.attrGroup || '$' : false,
    textNodeName: opts.textKey || '#text',
    cdataPropName: opts.cdata === 'key' ? opts.cdataKey || '#cdata' : false,
    commentPropName: opts.comments ? COMMENT_KEY : false,
    format: opts.indent !== 0,
    indentBy,
    suppressEmptyNode: opts.selfClose,
    suppressBooleanAttributes: false,
    processEntities: true,
  })
  let xml: string
  try {
    xml = builder.build(doc)
  } catch (e) {
    return { output: '', error: { message: e instanceof Error ? e.message : String(e) }, warnings: [] }
  }
  xml = xml.replace(/\n$/, '')
  if (opts.declaration) xml = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`
  const warnings: ConvertIssue[] = []
  if (ctx.renamed.size) {
    const list = [...ctx.renamed].slice(0, 4).map(([a, b]) => `“${a}” → <${b}>`)
    warnings.push({ message: `${plural(ctx.renamed.size, 'key')} ${ctx.renamed.size === 1 ? 'is' : 'are'} not a valid XML name and ${ctx.renamed.size === 1 ? 'was' : 'were'} renamed: ${list.join(', ')}${ctx.renamed.size > 4 ? '…' : ''}` })
  }
  if (ctx.nestedArrays) warnings.push({ message: `${plural(ctx.nestedArrays, 'nested array')} (arrays directly inside arrays) wrapped in <${itemName}> elements.` })
  if (ctx.objectAttrs) warnings.push({ message: `${plural(ctx.objectAttrs, 'attribute value')} ${ctx.objectAttrs === 1 ? 'was an object or array and is' : 'were objects or arrays and are'} written as JSON text.` })
  const check = validationError(xml)
  if (check) warnings.push({ message: `The generated XML did not pass validation: ${check.message} (line ${check.line}). Check keys that use the attribute or text conventions.` })
  return { output: xml, warnings, meta }
}

/** Small fixed XML document used to illustrate the current conventions. */
export const CONVENTION_SAMPLE = `<book id="7" xmlns:dc="urn:dc">
  <dc:title>Dune</dc:title>
  <tag>sci-fi</tag>
  <tag>classic</tag>
  <price cur="USD">9.99</price>
  <isbn>0441013597</isbn>
  <note><![CDATA[Spice < water]]></note>
  <!-- first edition -->
</book>`

/** Converts the sample with the given conventions — the mapping shown in the UI is always real. */
export function conventionExample(opts: XmlToJsonOptions): { xml: string; json: string } {
  const r = xmlToJson(CONVENTION_SAMPLE, { ...opts, indent: 2 })
  return { xml: CONVENTION_SAMPLE, json: r.error ? r.error.message : r.output }
}
