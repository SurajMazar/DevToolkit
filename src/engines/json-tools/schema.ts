/**
 * JSON Schema validation (interpreter-based, no code generation) and schema inference.
 */
import { Validator, type OutputUnit, type Schema, type SchemaDraft } from '@cfworker/json-schema'
import { isLosslessNumber } from '@/engines/json/parse'
import { parsePointer, toJsonPointer } from './paths'
import { setKey } from './util'

export type DraftChoice = 'auto' | SchemaDraft

export const DRAFTS: { value: DraftChoice; label: string; uri?: string }[] = [
  { value: 'auto', label: 'Auto ($schema)' },
  { value: '2020-12', label: '2020-12', uri: 'https://json-schema.org/draft/2020-12/schema' },
  { value: '2019-09', label: '2019-09', uri: 'https://json-schema.org/draft/2019-09/schema' },
  { value: '7', label: 'Draft 7', uri: 'http://json-schema.org/draft-07/schema#' },
  { value: '4', label: 'Draft 4', uri: 'http://json-schema.org/draft-04/schema#' },
]

/** Draft from a `$schema` URI. Draft 6 is validated with draft-7 rules (a superset). */
export function detectDraft(schema: unknown): { draft: SchemaDraft; detected: boolean; note?: string } {
  const uri = schema && typeof schema === 'object' ? (schema as { $schema?: unknown }).$schema : undefined
  if (typeof uri !== 'string') return { draft: '2020-12', detected: false, note: 'No $schema — using 2020-12' }
  if (/draft\/2020-12/.test(uri)) return { draft: '2020-12', detected: true }
  if (/draft\/2019-09/.test(uri)) return { draft: '2019-09', detected: true }
  if (/draft-07/.test(uri)) return { draft: '7', detected: true }
  if (/draft-06/.test(uri)) return { draft: '7', detected: true, note: 'Draft 6 validated with draft-7 rules' }
  if (/draft-04/.test(uri)) return { draft: '4', detected: true }
  if (/draft-03/.test(uri)) return { draft: '4', detected: true, note: 'Draft 3 is not supported — validated with draft-4 rules' }
  return { draft: '2020-12', detected: false, note: `Unrecognized $schema "${uri}" — using 2020-12` }
}

/** Validator needs plain JS numbers; also deep-copies (the validator annotates the schema object). */
export function toPlain(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  if (isLosslessNumber(v)) return Number((v as { value: string }).value)
  if (Array.isArray(v)) return v.map(toPlain)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v)) setKey(out, k, toPlain((v as Record<string, unknown>)[k]))
  return out
}

export interface SchemaError {
  /** JSON Pointer into the document ("" = root). */
  pointer: string
  keyword: string
  /** JSON Pointer into the schema (after `#`). */
  schemaPath: string
  message: string
  /** True for wrapper errors ("A subschema had errors") that summarize nested ones. */
  summary: boolean
}

export interface ValidationOutcome {
  valid: boolean
  errors: SchemaError[]
  draft: SchemaDraft
  draftNote?: string
}

const SUMMARY_KEYWORDS = new Set(['properties', 'items', 'prefixItems', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'allOf', '$ref', '$recursiveRef', 'then', 'else', 'dependentSchemas', 'patternProperties', 'additionalItems', 'contains', 'propertyNames'])

function fragmentToPointer(loc: string): string {
  try {
    return toJsonPointer(parsePointer(loc.startsWith('#') ? loc : '#' + loc))
  } catch {
    return loc.replace(/^#/, '')
  }
}

/** Follows a keywordLocation (which may pass through local `$ref`s) to the schema object it names. */
function resolveSchemaPath(root: unknown, path: string): Record<string, unknown> | null {
  let cur: unknown = root
  let segs: string[]
  try {
    segs = parsePointer(path)
  } catch {
    return null
  }
  for (let i = 0; i < segs.length; i++) {
    if (cur === null || typeof cur !== 'object') return null
    const seg = segs[i]
    if (seg === '$ref' || seg === '$dynamicRef' || seg === '$recursiveRef') {
      const ref = (cur as Record<string, unknown>)[seg]
      if (typeof ref !== 'string' || !ref.startsWith('#')) return null
      if (ref === '#') {
        cur = root
        continue
      }
      try {
        cur = parsePointer(ref).reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), root)
      } catch {
        return null
      }
      continue
    }
    cur = Array.isArray(cur) ? cur[Number(seg)] : (cur as Record<string, unknown>)[seg]
  }
  return cur && typeof cur === 'object' ? (cur as Record<string, unknown>) : null
}

function declaresProperty(schema: Record<string, unknown>, key: string): boolean {
  const props = schema.properties
  if (props && typeof props === 'object' && Object.prototype.hasOwnProperty.call(props, key)) return true
  const patterns = schema.patternProperties
  if (patterns && typeof patterns === 'object') {
    for (const p of Object.keys(patterns)) {
      try {
        if (new RegExp(p, 'u').test(key)) return true
      } catch {
        /* invalid pattern — reported by the validator */
      }
    }
  }
  return false
}

function unescapeLast(pointer: string): string {
  return pointer.slice(pointer.lastIndexOf('/') + 1).replace(/~1/g, '/').replace(/~0/g, '~')
}

function friendlyMessage(u: OutputUnit): string {
  const m = u.error
  const t = m.match(/^Instance type "(\w+)" is invalid\. Expected "(.+)"\.$/)
  if (t) return `Expected ${t[2].split('", "').join(' or ')}, got ${t[1]}`
  const r = m.match(/^Instance does not have required property "(.+)"\.$/)
  if (r) return `Missing required property "${r[1]}"`
  return m.replace(/^Instance /, 'Value ').replace(/\.$/, '')
}

export function validateDocument(doc: unknown, schema: unknown, draftChoice: DraftChoice = 'auto'): ValidationOutcome {
  if (typeof schema !== 'boolean' && (schema === null || typeof schema !== 'object' || Array.isArray(schema))) {
    throw new Error('The schema must be a JSON object (or a boolean schema)')
  }
  const auto = detectDraft(schema)
  const draft = draftChoice === 'auto' ? auto.draft : draftChoice
  let validator: Validator
  const plainSchema = toPlain(schema)
  try {
    validator = new Validator(toPlain(schema) as Schema | boolean, draft, false)
  } catch (e) {
    throw new Error(`Invalid schema: ${(e as Error).message}`)
  }
  let res
  try {
    res = validator.validate(toPlain(doc))
  } catch (e) {
    const msg = (e as Error).message
    if (/Unresolved \$ref|ref/i.test(msg)) throw new Error(`${msg}. Only references inside this schema can be resolved — remote schemas are never fetched.`)
    if (/Invalid regular expression/i.test(msg)) throw new Error(`The schema contains an invalid "pattern": ${msg}`)
    throw new Error(`Schema error: ${msg}`)
  }
  const seen = new Set<string>()
  let errors: SchemaError[] = []
  for (const u of res.errors) {
    const pointer = fragmentToPointer(u.instanceLocation)
    const schemaPath = fragmentToPointer(u.keywordLocation)
    const key = `${pointer}|${schemaPath}|${u.error}`
    if (seen.has(key)) continue
    seen.add(key)
    const summary = SUMMARY_KEYWORDS.has(u.keyword) && /subschema had errors|did not match|does not match (schema|additional|unevaluated|every|"then"|"else")|but does not match/i.test(u.error)
    errors.push({ pointer, keyword: u.keyword, schemaPath, message: friendlyMessage(u), summary })
  }
  // cfworker (non-short-circuit mode) also reports properties that are declared in `properties`
  // but failed validation as "additional". Per spec, additionalProperties only applies to keys not
  // matched by properties/patternProperties — drop those spurious reports (and their `false` child).
  const spurious = new Set<string>()
  for (const e of errors) {
    if (e.keyword !== 'additionalProperties') continue
    const key = e.message.match(/^Property "(.*)" does not match additional properties schema$/s)?.[1]
    if (key === undefined) continue
    const owner = resolveSchemaPath(plainSchema, e.schemaPath.replace(/\/additionalProperties$/, ''))
    if (owner && declaresProperty(owner, key)) {
      spurious.add(`${e.pointer}|${e.schemaPath}|${key}`)
    }
  }
  if (spurious.size) {
    errors = errors.filter((e) => {
      if (e.keyword === 'additionalProperties') {
        const key = e.message.match(/^Property "(.*)" does not match additional properties schema$/s)?.[1]
        return key === undefined || !spurious.has(`${e.pointer}|${e.schemaPath}|${key}`)
      }
      if (e.keyword === 'false') {
        const parent = e.pointer.slice(0, e.pointer.lastIndexOf('/'))
        const key = unescapeLast(e.pointer)
        for (const s of spurious) if (s.startsWith(parent + '|') && s.endsWith('|' + key) && s.split('|')[0] === parent) return false
      }
      return true
    })
  }
  // A `false` subschema (e.g. additionalProperties: false) produces a bare "False boolean schema"
  // at the child plus a wrapper at the parent. Merge them into one actionable error on the child.
  const drop = new Set<SchemaError>()
  for (const e of errors) {
    if (e.keyword !== 'false') continue
    const parent = e.pointer.slice(0, e.pointer.lastIndexOf('/'))
    const name = unescapeLast(e.pointer)
    const wrapper = errors.find((w) => w.summary && w.pointer === parent && w.message.includes(`"${name}"`) && !drop.has(w))
    const kw = wrapper?.keyword ?? 'false'
    e.keyword = kw
    if (wrapper) {
      e.schemaPath = wrapper.schemaPath
      drop.add(wrapper)
    }
    e.message = /Properties$/.test(kw) ? `Property "${name}" is not allowed (${kw}: false)` : /Items$|items/.test(kw) ? `Item ${name} is not allowed (${kw}: false)` : 'Value is not allowed here (schema is false)'
  }
  if (drop.size) errors = errors.filter((e) => !drop.has(e))
  // Most specific (deepest) problems first, then document order.
  errors.sort((a, b) => Number(a.summary) - Number(b.summary))
  return { valid: res.valid, errors, draft, draftNote: draftChoice === 'auto' ? auto.note : undefined }
}

// ── Schema inference ─────────────────────────────────────────────────────────

type JsonSchemaType = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null'

interface Shape {
  types: Set<JsonSchemaType>
  /** For objects: property shapes and how many object samples contained each key. */
  props?: Map<string, Shape>
  propCount?: Map<string, number>
  objectSamples: number
  items?: Shape
  formats?: Set<string>
}

const emptyShape = (): Shape => ({ types: new Set(), objectSamples: 0 })

const RE_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RE_URI = /^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i

function detectFormat(s: string): string | null {
  if (RE_DATE_TIME.test(s)) return 'date-time'
  if (RE_DATE.test(s)) return 'date'
  if (RE_UUID.test(s)) return 'uuid'
  if (RE_EMAIL.test(s)) return 'email'
  if (RE_URI.test(s)) return 'uri'
  return null
}

function observe(shape: Shape, v: unknown, formats: boolean) {
  if (v === null) shape.types.add('null')
  else if (Array.isArray(v)) {
    shape.types.add('array')
    shape.items ??= emptyShape()
    for (const x of v) observe(shape.items, x, formats)
  } else if (isLosslessNumber(v)) {
    shape.types.add(/^-?\d+$/.test((v as { value: string }).value) ? 'integer' : 'number')
  } else if (typeof v === 'object') {
    shape.types.add('object')
    shape.props ??= new Map()
    shape.propCount ??= new Map()
    shape.objectSamples++
    for (const k of Object.keys(v as object)) {
      let p = shape.props.get(k)
      if (!p) shape.props.set(k, (p = emptyShape()))
      shape.propCount.set(k, (shape.propCount.get(k) ?? 0) + 1)
      observe(p, (v as Record<string, unknown>)[k], formats)
    }
  } else if (typeof v === 'number') shape.types.add(Number.isInteger(v) ? 'integer' : 'number')
  else if (typeof v === 'boolean') shape.types.add('boolean')
  else if (typeof v === 'string') {
    shape.types.add('string')
    if (formats) {
      const f = detectFormat(v)
      // A format is only kept when every observed string agrees.
      if (!shape.formats) shape.formats = new Set(f ? [f] : ['-'])
      else shape.formats.add(f ?? '-')
    }
  }
}

export interface InferOptions {
  /** Add `required` for keys present in every sample. Default true. */
  required?: boolean
  /** Set `additionalProperties: false`. Default false. */
  strict?: boolean
  /** Detect string formats (date-time, email, uuid, uri, date). Default true. */
  formats?: boolean
  title?: string
}

const TYPE_ORDER = ['string', 'integer', 'number', 'boolean', 'object', 'array', 'null']

function shapeToSchema(shape: Shape, opts: Required<Omit<InferOptions, 'title'>>): Record<string, unknown> {
  const types = new Set(shape.types)
  if (types.has('integer') && types.has('number')) types.delete('integer')
  if (types.size === 0) return {}
  const variants: Record<string, unknown>[] = []
  const simple: string[] = []
  for (const t of types) {
    if (t === 'object') {
      const s: Record<string, unknown> = { type: 'object' }
      const props: Record<string, unknown> = {}
      for (const [k, p] of shape.props ?? []) setKey(props, k, shapeToSchema(p, opts))
      s.properties = props
      if (opts.required) {
        const req = [...(shape.propCount ?? [])].filter(([, n]) => n === shape.objectSamples).map(([k]) => k)
        if (req.length) s.required = req
      }
      if (opts.strict) s.additionalProperties = false
      variants.push(s)
    } else if (t === 'array') {
      const s: Record<string, unknown> = { type: 'array' }
      if (shape.items && shape.items.types.size) s.items = shapeToSchema(shape.items, opts)
      variants.push(s)
    } else if (t === 'string' && shape.formats && shape.formats.size === 1 && !shape.formats.has('-')) {
      variants.push({ type: 'string', format: [...shape.formats][0] })
    } else simple.push(t)
  }
  simple.sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b))
  if (variants.length === 0) return { type: simple.length === 1 ? simple[0] : simple }
  if (variants.length === 1 && simple.length === 0) return variants[0]
  // Mixed containers / primitives: anyOf keeps each variant precise.
  const any = [...variants]
  if (simple.length) any.push({ type: simple.length === 1 ? simple[0] : simple })
  return { anyOf: any }
}

/** Infers a draft 2020-12 schema describing `value` (array items are merged across elements). */
export function inferSchema(value: unknown, options: InferOptions = {}): Record<string, unknown> {
  const opts = { required: options.required ?? true, strict: options.strict ?? false, formats: options.formats ?? true }
  const shape = emptyShape()
  observe(shape, value, opts.formats)
  const body = shapeToSchema(shape, opts)
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...(options.title ? { title: options.title } : {}), ...body }
}
