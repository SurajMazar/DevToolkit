/**
 * Text-in / structured-clone-safe-out entry points used by the tools' workers (and called
 * directly for small inputs). Each returns either a result or an error with a location.
 */
import { offsetToLineColumn, parseJson, type JsonErrorInfo } from '@/engines/json/parse'
import { stringifyJson } from '@/engines/json/stringify'
import { buildTree, type TreeIndex } from './tree'
import { locatePointer } from './locate'
import { listAllPaths, queryJsonPath, JsonPathSyntaxError, type DocumentPath, type QueryResult } from './jsonpath'
import { validateDocument, inferSchema, type DraftChoice, type ValidationOutcome } from './schema'
import { compareStructure, deepMerge, extractKeyPaths, extractLeafValues, flatten, prune, sortKeys, unflatten, type ArrayMergeStrategy, type StructureDiff } from './object-utils'
import { jsonToTypeScript, jsonToZod, type TsOptions } from './typescript'

export type TaskError = { message: string; line?: number; column?: number; source?: 'document' | 'schema' | 'query' | 'second' }
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: TaskError }

const fail = (e: JsonErrorInfo, source?: TaskError['source']): { ok: false; error: TaskError } => ({ ok: false, error: { message: e.message, line: e.line, column: e.column, source } })

// ── Tree ────────────────────────────────────────────────────────────────────

export function parseToTree(text: string): Outcome<TreeIndex & { hasBigNumbers: boolean }> {
  const r = parseJson(text)
  if (!r.ok) return fail(r.error)
  try {
    return { ok: true, value: { ...buildTree(r.value), hasBigNumbers: r.hasBigNumbers } }
  } catch (e) {
    return { ok: false, error: { message: (e as Error).message } }
  }
}

// ── JSONPath ────────────────────────────────────────────────────────────────

export interface QueryPayload {
  text: string
  expr: string
  limit?: number
}

export function runJsonPath({ text, expr, limit }: QueryPayload): Outcome<QueryResult> {
  const r = parseJson(text)
  if (!r.ok) return fail(r.error, 'document')
  try {
    return { ok: true, value: queryJsonPath(r.value, expr, { limit, hasBigNumbers: r.hasBigNumbers }) }
  } catch (e) {
    const column = e instanceof JsonPathSyntaxError ? e.column : undefined
    return { ok: false, error: { message: (e as Error).message, column, source: 'query' } }
  }
}

export function listPaths({ text, limit }: { text: string; limit?: number }): Outcome<{ paths: DocumentPath[]; total: number; capped: boolean }> {
  const r = parseJson(text)
  if (!r.ok) return fail(r.error, 'document')
  return { ok: true, value: listAllPaths(r.value, limit) }
}

// ── Schema ──────────────────────────────────────────────────────────────────

export interface LocatedRange {
  line: number
  column: number
  endLine: number
  endColumn: number
  /** False when the pointer does not exist (e.g. a missing property) — the range is its parent. */
  exact: boolean
  /** Position of the member's key (object members only). */
  keyLine?: number
  keyColumn?: number
}

export type ValidationWithLocations = ValidationOutcome & {
  /** Source ranges by instance pointer (the first `MAX_LOCATED` distinct pointers). */
  locations: Record<string, LocatedRange>
  locatedAll: boolean
}

/** Each lookup scans the text, so only the first N distinct pointers are mapped. */
export const MAX_LOCATED = 500

export function runSchemaValidation({ doc, schema, draft }: { doc: string; schema: string; draft: DraftChoice }): Outcome<ValidationWithLocations> {
  const s = parseJson(schema)
  if (!s.ok) return fail(s.error, 'schema')
  const d = parseJson(doc)
  if (!d.ok) return fail(d.error, 'document')
  let res: ValidationOutcome
  try {
    res = validateDocument(d.value, s.value, draft)
  } catch (e) {
    return { ok: false, error: { message: (e as Error).message, source: 'schema' } }
  }
  const locations: Record<string, LocatedRange> = {}
  let count = 0
  let locatedAll = true
  for (const e of res.errors) {
    if (Object.prototype.hasOwnProperty.call(locations, e.pointer)) continue
    if (count >= MAX_LOCATED) {
      locatedAll = false
      break
    }
    count++
    try {
      const l = locatePointer(doc, e.pointer)
      if (l) {
        const range: LocatedRange = { line: l.line, column: l.column, endLine: l.endLine, endColumn: l.endColumn, exact: l.exact }
        if (l.keyOffset != null && l.exact) {
          const k = offsetToLineColumn(doc, l.keyOffset)
          range.keyLine = k.line
          range.keyColumn = k.column
        }
        locations[e.pointer] = range
      }
    } catch {
      /* malformed pointer — leave unlocated */
    }
  }
  return { ok: true, value: { ...res, locations, locatedAll } }
}

export function generateSchema({ doc, required, strict, formats }: { doc: string; required?: boolean; strict?: boolean; formats?: boolean }): Outcome<string> {
  const d = parseJson(doc)
  if (!d.ok) return fail(d.error, 'document')
  return { ok: true, value: stringifyJson(inferSchema(d.value, { required, strict, formats }), { indent: 2 }) }
}

// ── Object utilities ────────────────────────────────────────────────────────

export type ObjectOp = 'flatten' | 'unflatten' | 'sort' | 'removeNulls' | 'removeEmpty' | 'keys' | 'values' | 'merge' | 'compare'

export interface ObjectOpOptions {
  delimiter: string
  arrays: 'dot' | 'bracket'
  maxDepth: number
  numericArrays: boolean
  sortOrder: 'asc' | 'desc'
  collation: 'natural' | 'codepoint'
  inArrays: boolean
  empty: { null: boolean; emptyString: boolean; emptyArray: boolean; emptyObject: boolean }
  cascade: boolean
  collapseIndices: boolean
  leavesOnly: boolean
  valuesFormat: 'json' | 'lines'
  uniqueValues: boolean
  mergeArrays: ArrayMergeStrategy
  skipNulls: boolean
  indent: number
}

export const DEFAULT_OBJECT_OPTIONS: ObjectOpOptions = {
  delimiter: '.',
  arrays: 'dot',
  maxDepth: 0,
  numericArrays: true,
  sortOrder: 'asc',
  collation: 'natural',
  inArrays: false,
  empty: { null: true, emptyString: true, emptyArray: true, emptyObject: true },
  cascade: true,
  collapseIndices: true,
  leavesOnly: false,
  valuesFormat: 'json',
  uniqueValues: false,
  mergeArrays: 'replace',
  skipNulls: false,
  indent: 2,
}

export interface ObjectOpResult {
  output: string
  /** Short summary for the status bar ("42 keys", "3 fields removed"…). */
  summary: string
  warnings: string[]
  diff?: StructureDiff
}

export function runObjectOp({ op, text, text2, options }: { op: ObjectOp; text: string; text2?: string; options: ObjectOpOptions }): Outcome<ObjectOpResult> {
  const r = parseJson(text)
  if (!r.ok) return fail(r.error, 'document')
  const o = options
  const json = (v: unknown) => stringifyJson(v, { indent: o.indent })
  const warnings: string[] = []
  try {
    switch (op) {
      case 'flatten': {
        const f = flatten(r.value, { delimiter: o.delimiter, arrays: o.arrays, maxDepth: o.maxDepth })
        if (f.ambiguousKeys.length) warnings.push(`${f.ambiguousKeys.length} key${f.ambiguousKeys.length === 1 ? '' : 's'} already contain "${o.delimiter}" (e.g. "${f.ambiguousKeys[0]}") — unflattening will not restore the original structure.`)
        if (f.collisions.length) warnings.push(`${f.collisions.length} flattened key${f.collisions.length === 1 ? '' : 's'} collided (e.g. "${f.collisions[0]}") — the later value was kept.`)
        return { ok: true, value: { output: json(f.value), summary: `${Object.keys(f.value).length.toLocaleString('en-US')} flat keys`, warnings } }
      }
      case 'unflatten': {
        const v = unflatten(r.value, { delimiter: o.delimiter, numericArrays: o.numericArrays })
        return { ok: true, value: { output: json(v), summary: `${Object.keys(r.value as object).length.toLocaleString('en-US')} keys unflattened`, warnings } }
      }
      case 'sort':
        return { ok: true, value: { output: json(sortKeys(r.value, { order: o.sortOrder, collation: o.collation })), summary: `Sorted ${o.sortOrder === 'asc' ? 'A→Z' : 'Z→A'}`, warnings } }
      case 'removeNulls': {
        const p = prune(r.value, { null: true, inArrays: o.inArrays, cascade: false })
        return { ok: true, value: { output: json(p.value), summary: `${p.removed.toLocaleString('en-US')} null${p.removed === 1 ? '' : 's'} removed`, warnings } }
      }
      case 'removeEmpty': {
        const p = prune(r.value, { ...o.empty, inArrays: o.inArrays, cascade: o.cascade })
        return { ok: true, value: { output: json(p.value), summary: `${p.removed.toLocaleString('en-US')} empty value${p.removed === 1 ? '' : 's'} removed`, warnings } }
      }
      case 'keys': {
        const keys = extractKeyPaths(r.value, { collapseIndices: o.collapseIndices, leavesOnly: o.leavesOnly, delimiter: o.delimiter })
        return { ok: true, value: { output: keys.join('\n'), summary: `${keys.length.toLocaleString('en-US')} key paths`, warnings } }
      }
      case 'values': {
        const vals = extractLeafValues(r.value, { unique: o.uniqueValues })
        const output = o.valuesFormat === 'json' ? json(vals) : vals.map((v) => (typeof v === 'string' ? v : stringifyJson(v))).join('\n')
        if (o.valuesFormat === 'lines' && vals.some((v) => typeof v === 'string' && /[\r\n]/.test(v))) warnings.push('Some string values contain line breaks, so lines do not map 1:1 to values — use JSON array output for an exact list.')
        return { ok: true, value: { output, summary: `${vals.length.toLocaleString('en-US')} leaf values`, warnings } }
      }
      case 'merge':
      case 'compare': {
        if (!text2?.trim()) return { ok: false, error: { message: `Paste the second JSON document (B) to ${op === 'merge' ? 'merge' : 'compare'}`, source: 'second' } }
        const b = parseJson(text2)
        if (!b.ok) return fail(b.error, 'second')
        if (op === 'merge') {
          const merged = deepMerge(r.value, b.value, { arrays: o.mergeArrays, skipNulls: o.skipNulls })
          return { ok: true, value: { output: json(merged), summary: `Merged with arrays: ${o.mergeArrays}`, warnings } }
        }
        const diff = compareStructure(r.value, b.value)
        return { ok: true, value: { output: '', summary: `${diff.onlyA + diff.onlyB + diff.typeChanged} differences`, warnings, diff } }
      }
    }
  } catch (e) {
    return { ok: false, error: { message: (e as Error).message } }
  }
}

// ── TypeScript ──────────────────────────────────────────────────────────────

export function generateTypes({ text, format, options }: { text: string; format: 'typescript' | 'zod'; options: TsOptions }): Outcome<{ code: string; declarations: number; hasBigNumbers: boolean }> {
  const r = parseJson(text)
  if (!r.ok) return fail(r.error)
  const res = format === 'zod' ? jsonToZod(r.value, options) : jsonToTypeScript(r.value, options)
  return { ok: true, value: { ...res, hasBigNumbers: r.hasBigNumbers } }
}
