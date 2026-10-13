/**
 * JSON ⇄ YAML with the `yaml` package (eemeli/yaml).
 *
 * Precision: YAML integers are parsed as BigInt and floats with more digits than a
 * double holds are kept as LosslessNumber, so 64-bit IDs survive YAML → JSON. In the
 * other direction LosslessNumbers from the JSON parser are written with their original
 * digits.
 *
 * YAML version:
 * - 1.2 (default, "core" schema): only true/false are booleans, only null/~/empty are null,
 *   0o17 is octal. `yes`, `no`, `on`, `off`, `y`, `n` are plain strings.
 * - 1.1: yes/no/on/off/y/n are booleans, 017 is octal, 1:20 is sexagesimal (80),
 *   2001-12-14 is a timestamp, `<<` merge keys are built in.
 */
import { Document, isCollection, isScalar, parseAllDocuments, visit, type Scalar, type Tags, type ToStringOptions } from 'yaml'
import { LosslessNumber, isLosslessNumber, isSafeNumber } from 'lossless-json'
import { parseJsonKeepNumbers } from './json-text'
import { stringifyJson } from '@/engines/json/stringify'

export type YamlVersion = '1.1' | '1.2'

export interface ConvertIssue {
  message: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface ConvertResult {
  output: string
  error?: ConvertIssue
  warnings: ConvertIssue[]
  /** Short summary (e.g. "3 documents"). */
  meta?: string
}

// ── YAML → JSON ──────────────────────────────────────────────────────────────

export interface YamlToJsonOptions {
  version: YamlVersion
  /** Several `---` documents: emit an array of all of them, or only the first. */
  multiDoc: 'array' | 'first'
  /** Resolve `<<` merge keys (always on in 1.1). */
  merge: boolean
  indent: number | '\t'
  sortKeys: boolean
}

export const DEFAULT_YAML_TO_JSON: YamlToJsonOptions = { version: '1.2', multiDoc: 'array', merge: true, indent: 2, sortKeys: false }

const RE_DECIMAL = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/

/** Wraps the schema's float tags so over-precise decimals become LosslessNumber. */
function preciseFloats(tags: Tags): Tags {
  return tags.map((t) => {
    if (typeof t !== 'object' || t.tag !== 'tag:yaml.org,2002:float' || !('test' in t) || !t.test || t.format === 'TIME') return t
    const orig = t.resolve as (...args: unknown[]) => unknown
    return {
      ...t,
      resolve(str: string, ...rest: unknown[]) {
        const n = str.replace(/_/g, '').replace(/^\+/, '')
        if (RE_DECIMAL.test(n) && !isSafeNumber(n)) return new LosslessNumber(n)
        return orig.call(this, str, ...rest)
      },
    } as typeof t
  }) as Tags
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

interface Lossy {
  nonFinite: number
  dates: number
  binary: number
}

/** Converts yaml's toJS() output into JSON-safe values. */
function jsonify(v: unknown, lossy: Lossy): unknown {
  if (typeof v === 'bigint') {
    const n = Number(v)
    return Number.isSafeInteger(n) ? n : new LosslessNumber(v.toString())
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) lossy.nonFinite++
    return v
  }
  if (v === null || typeof v !== 'object' || isLosslessNumber(v)) return v
  if (v instanceof Date) {
    lossy.dates++
    return Number.isNaN(v.getTime()) ? null : v.toISOString()
  }
  if (v instanceof Uint8Array) {
    lossy.binary++
    return toBase64(v)
  }
  if (Array.isArray(v)) return v.map((x) => jsonify(x, lossy))
  if (v instanceof Set) return [...v].map((x) => jsonify(x, lossy))
  if (v instanceof Map) {
    const o: Record<string, unknown> = {}
    for (const [k, x] of v) o[String(k)] = jsonify(x, lossy)
    return o
  }
  const o: Record<string, unknown> = {}
  for (const k of Object.keys(v)) o[k] = jsonify((v as Record<string, unknown>)[k], lossy)
  return o
}

function firstLine(msg: string) {
  return msg.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '')
}

function issueFrom(e: { message: string; linePos?: [{ line: number; col: number }] | [{ line: number; col: number }, { line: number; col: number }] }): ConvertIssue {
  const lp = e.linePos
  return {
    message: firstLine(e.message),
    line: lp?.[0]?.line,
    column: lp?.[0]?.col,
    endLine: lp?.[1]?.line,
    endColumn: lp?.[1]?.col,
  }
}

const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`

export function yamlToJson(text: string, opts: YamlToJsonOptions = DEFAULT_YAML_TO_JSON): ConvertResult {
  const docs = parseAllDocuments(text, {
    version: opts.version,
    intAsBigInt: true,
    customTags: preciseFloats,
    merge: opts.merge || opts.version === '1.1',
    uniqueKeys: true,
    prettyErrors: true,
    logLevel: 'silent',
    strict: true,
  })
  const list = [...docs]
  const warnings: ConvertIssue[] = []
  for (const d of list) {
    if (d.errors.length) return { output: '', error: issueFrom(d.errors[0]), warnings: d.errors.slice(1).map(issueFrom) }
  }
  // Unresolved custom tags are reported once below, in plain words.
  for (const d of list) for (const w of d.warnings) if (w.code !== 'TAG_RESOLVE_FAILED') warnings.push(issueFrom(w))

  // Detect YAML features that JSON can't represent.
  let aliases = 0
  let tags = 0
  let comments = false
  let complexKeys = 0
  let nonStringKeys = 0
  for (const d of list) {
    if (d.commentBefore || d.comment) comments = true
    visit(d, {
      Alias() {
        aliases++
      },
      Node(_k, node) {
        if (node.commentBefore || node.comment) comments = true
        const tag = (node as { tag?: string }).tag
        if (tag && !tag.startsWith('tag:yaml.org,2002:')) tags++
      },
      Pair(_k, pair) {
        if (isCollection(pair.key)) complexKeys++
        else if (isScalar(pair.key) && pair.key.value !== null && typeof pair.key.value !== 'string') nonStringKeys++
      },
    })
  }
  if (aliases) warnings.push({ message: `${plural(aliases, 'alias', 'aliases')} (*ref) expanded into copies of the anchored value — JSON has no references.` })
  if (tags) warnings.push({ message: `${plural(tags, 'custom tag')} (e.g. !Ref) dropped — the tagged value is kept as plain data.` })
  if (comments) warnings.push({ message: `Comments are dropped — JSON has no comments.` })
  if (complexKeys) warnings.push({ message: `${plural(complexKeys, 'collection key')} turned into ${complexKeys === 1 ? 'a string' : 'strings'} — JSON keys must be strings.` })
  if (nonStringKeys) warnings.push({ message: `${plural(nonStringKeys, 'non-string key')} (numbers, booleans) converted to strings.` })

  const lossy: Lossy = { nonFinite: 0, dates: 0, binary: 0 }
  const values = list.map((d) => jsonify(d.toJS({ maxAliasCount: 10_000 }), lossy))
  if (lossy.nonFinite) warnings.push({ message: `${plural(lossy.nonFinite, 'value')} (.inf / .nan) can't be represented in JSON and became null.` })
  if (lossy.dates) warnings.push({ message: `${plural(lossy.dates, 'timestamp')} converted to ISO 8601 strings (YAML 1.1 !!timestamp).` })
  if (lossy.binary) warnings.push({ message: `${plural(lossy.binary, '!!binary value')} written as Base64 strings.` })

  let value: unknown
  let meta: string | undefined
  if (list.length === 0) {
    value = null
    meta = 'empty document'
  } else if (list.length === 1) value = values[0]
  else if (opts.multiDoc === 'array') {
    value = values
    meta = `${list.length} documents → array`
  } else {
    value = values[0]
    meta = `first of ${list.length} documents`
    warnings.push({ message: `Input has ${list.length} documents (separated by ---); only the first was converted. Choose “All documents → array” to keep them all.` })
  }
  return { output: stringifyJson(value, { indent: opts.indent === 0 ? '' : opts.indent, sortKeys: opts.sortKeys }), warnings, meta }
}

// ── JSON → YAML ──────────────────────────────────────────────────────────────

export type StringStyle = 'plain' | 'single' | 'double'

export interface JsonToYamlOptions {
  indent: number
  version: YamlVersion
  /** Quote strings another YAML version would read as non-strings (`yes`, `on`, `0o17`, `1:20`…). */
  quoteAmbiguous: boolean
  sortKeys: boolean
  stringStyle: StringStyle
  /** 0 = never wrap long strings. */
  lineWidth: number
  /** Write a top-level array as a stream of `---` documents. */
  arrayAsDocuments: boolean
  /** Indent `- ` items under their parent key. */
  indentSeq: boolean
}

export const DEFAULT_JSON_TO_YAML: JsonToYamlOptions = {
  indent: 2,
  version: '1.2',
  quoteAmbiguous: true,
  sortKeys: false,
  stringStyle: 'plain',
  lineWidth: 0,
  arrayAsDocuments: false,
  indentSeq: true,
}

const losslessTag = {
  identify: (v: unknown) => isLosslessNumber(v),
  default: true,
  tag: 'tag:yaml.org,2002:float',
  resolve: (s: string) => s,
  stringify: (item: Scalar) => (item.value as { value: string }).value,
}

let ambiguityTests: RegExp[] | null = null
/** Regexes that make a plain scalar resolve to a non-string in YAML 1.1 or 1.2. */
function ambiguityPatterns(): RegExp[] {
  if (ambiguityTests) return ambiguityTests
  const out: RegExp[] = []
  for (const version of ['1.1', '1.2'] as const) {
    const doc = new Document(null, { version, merge: true })
    for (const t of doc.schema.tags) if ('test' in t && t.test instanceof RegExp && t.tag !== 'tag:yaml.org,2002:str') out.push(t.test)
  }
  ambiguityTests = out
  return out
}

export function isAmbiguousString(s: string): boolean {
  return ambiguityPatterns().some((re) => re.test(s))
}

const STYLE_TYPE = { plain: 'PLAIN', single: 'QUOTE_SINGLE', double: 'QUOTE_DOUBLE' } as const

export function jsonToYaml(text: string, opts: JsonToYamlOptions = DEFAULT_JSON_TO_YAML): ConvertResult {
  const parsed = parseJsonKeepNumbers(text)
  if (!parsed.ok) return { output: '', error: parsed.error, warnings: [] }
  const value = parsed.value
  const docs = opts.arrayAsDocuments && Array.isArray(value) ? value : [value]
  const toStringOpts: ToStringOptions = {
    indent: Math.max(1, Math.min(8, opts.indent)),
    indentSeq: opts.indentSeq,
    lineWidth: opts.lineWidth > 0 ? opts.lineWidth : 0,
    minContentWidth: opts.lineWidth > 0 ? 20 : 0,
    defaultStringType: STYLE_TYPE[opts.stringStyle],
    defaultKeyType: 'PLAIN',
    singleQuote: opts.stringStyle === 'single' ? true : opts.stringStyle === 'double' ? false : null,
  }
  const parts: string[] = []
  let quoted = 0
  for (const v of docs) {
    const doc = new Document(v, { version: opts.version, customTags: [losslessTag], sortMapEntries: opts.sortKeys })
    if (opts.quoteAmbiguous && opts.stringStyle === 'plain') {
      visit(doc, {
        Scalar(key, node) {
          // Values only: keys are left as the library writes them (`on:` stays readable).
          if (key !== 'key' && typeof node.value === 'string' && node.value !== '' && isAmbiguousString(node.value)) {
            node.type = 'QUOTE_DOUBLE'
            quoted++
          }
        },
      })
    }
    parts.push(doc.toString(toStringOpts))
  }
  const output = docs.length > 1 || (opts.arrayAsDocuments && Array.isArray(value)) ? parts.map((p) => `---\n${p}`).join('') : parts.join('')
  const metaParts: string[] = []
  if (opts.arrayAsDocuments && Array.isArray(value)) metaParts.push(`${plural(docs.length, 'document')}`)
  if (quoted) metaParts.push(`${plural(quoted, 'ambiguous string')} quoted`)
  return { output: opts.arrayAsDocuments && Array.isArray(value) && docs.length === 0 ? '' : output, warnings: [], meta: metaParts.join(' · ') || undefined }
}

