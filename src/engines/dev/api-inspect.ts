/**
 * Profiling for JSON API responses: overview counts, inferred shape, per-array statistics,
 * key/value search, path extraction and structural comparison. Pure and worker-safe.
 */
import { isLosslessNumber, jsonTypeOf, numberText, parseJson, type JsonErrorInfo, type JsonType } from '@/engines/json/parse'

export type { JsonType }

// ---------------------------------------------------------------------------
// HTTP envelope
// ---------------------------------------------------------------------------

export interface HttpEnvelope {
  body: string
  /** Status lines seen (e.g. "HTTP/1.1 100 Continue", "HTTP/2 200"). */
  statusLines: string[]
  headers: { name: string; value: string }[]
  /** Number of lines before the body in the original text (to map error lines back). */
  bodyLineOffset: number
  /** Character offset of the body in the original text. */
  bodyOffset: number
}

const STATUS_LINE = /^HTTP\/\d(?:\.\d)?\s+\d{3}\b.*$/
const HEADER_LINE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+:\s?.*$|^:[a-z]+:\s?.*$/

/** Strips a raw HTTP response head (status line + headers) if present. */
export function splitHttpResponse(text: string): HttpEnvelope {
  const none: HttpEnvelope = { body: text, statusLines: [], headers: [], bodyLineOffset: 0, bodyOffset: 0 }
  let offset = 0
  let lineOffset = 0
  const statusLines: string[] = []
  const headers: HttpEnvelope['headers'] = []
  // Loop to skip interim responses (100 Continue) followed by the final response.
  for (let guard = 0; guard < 5; guard++) {
    const rest = text.slice(offset)
    const lead = /^\s*/.exec(rest)![0]
    const startsJson = /^[[{]/.test(rest.slice(lead.length))
    if (startsJson) break
    const sep = /\r?\n[ \t]*\r?\n/.exec(rest)
    const headEnd = sep ? sep.index : rest.length
    const lines = rest.slice(0, headEnd).split(/\r?\n/)
    const first = lines[0].trim()
    const isStatus = STATUS_LINE.test(first)
    const headerLines = isStatus ? lines.slice(1) : lines
    if (!isStatus && !(headerLines.length > 0 && headerLines.every((l) => !l.trim() || HEADER_LINE.test(l.trim()) || /^[ \t]/.test(l)))) break
    if (!isStatus && !sep) break
    if (isStatus) statusLines.push(first)
    for (const l of headerLines) {
      if (/^[ \t]/.test(l) && headers.length) headers[headers.length - 1].value += ' ' + l.trim()
      else {
        const m = /^(:?[^:]+):\s?(.*)$/.exec(l.trim())
        if (m) headers.push({ name: m[1].trim(), value: m[2].trim() })
      }
    }
    const consumed = sep ? headEnd + sep[0].length : rest.length
    lineOffset += countNl(rest.slice(0, consumed))
    offset += consumed
  }
  if (offset === 0) return none
  return { body: text.slice(offset), statusLines, headers, bodyLineOffset: lineOffset, bodyOffset: offset }
}

function countNl(s: string) {
  let n = 0
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  return n
}

// ---------------------------------------------------------------------------
// Paths and previews
// ---------------------------------------------------------------------------

const IDENT = /^[A-Za-z_$][\w$]*$/

export function childPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`
  if (IDENT.test(key)) return `${parent}.${key}`
  return `${parent}['${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`
}

export function preview(v: unknown, max = 60): string {
  const t = jsonTypeOf(v)
  if (t === 'object') return `{…} ${Object.keys(v as object).length} keys`
  if (t === 'array') return `[…] ${(v as unknown[]).length} items`
  if (t === 'number') return numberText(v)
  if (t === 'string') {
    const s = JSON.stringify(v)
    return s.length > max ? s.slice(0, max - 1) + '…"' : s
  }
  return String(v)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !isLosslessNumber(v)
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface Overview {
  nodes: number
  depth: number
  totalKeys: number
  uniqueKeys: number
  counts: Record<JsonType, number>
  arrays: number
  maxArrayLength: number
  longestString: number
  emptyContainers: number
}

export function computeOverview(root: unknown): Overview {
  const counts: Record<JsonType, number> = { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 }
  const keys = new Set<string>()
  let nodes = 0
  let depth = 0
  let totalKeys = 0
  let maxArrayLength = 0
  let longestString = 0
  let emptyContainers = 0
  const stack: [unknown, number][] = [[root, 1]]
  while (stack.length) {
    const [v, d] = stack.pop()!
    nodes++
    if (d > depth) depth = d
    const t = jsonTypeOf(v)
    counts[t]++
    if (t === 'object') {
      const ks = Object.keys(v as object)
      totalKeys += ks.length
      if (!ks.length) emptyContainers++
      for (const k of ks) {
        if (keys.size < 100_000) keys.add(k)
        stack.push([(v as Record<string, unknown>)[k], d + 1])
      }
    } else if (t === 'array') {
      const a = v as unknown[]
      if (a.length > maxArrayLength) maxArrayLength = a.length
      if (!a.length) emptyContainers++
      for (let i = a.length - 1; i >= 0; i--) stack.push([a[i], d + 1])
    } else if (t === 'string' && (v as string).length > longestString) longestString = (v as string).length
  }
  return { nodes, depth, totalKeys, uniqueKeys: keys.size, counts, arrays: counts.array, maxArrayLength, longestString, emptyContainers }
}

// ---------------------------------------------------------------------------
// Shape inference
// ---------------------------------------------------------------------------

export interface ShapeNode {
  /** Field name, "[]" for array items, "$" for the root. */
  key: string
  /** Normalised path with [*] for array items. */
  path: string
  types: Partial<Record<JsonType, number>>
  /** How many values were seen at this path. */
  seen: number
  /** Present in every parent object (fields only). */
  required: boolean
  /** Present in this many parent objects (fields only). */
  presentIn?: number
  parentCount?: number
  examples: string[]
  children?: ShapeNode[]
  /** More keys than the cap were seen; extra keys were not tracked. */
  truncatedKeys?: number
}

interface Acc {
  types: Map<JsonType, number>
  seen: number
  examples: string[]
  objectCount: number
  fields?: Map<string, Acc>
  droppedKeys: number
  items?: Acc
}

const MAX_FIELDS = 400
const newAcc = (): Acc => ({ types: new Map(), seen: 0, examples: [], objectCount: 0, droppedKeys: 0 })

function accumulate(root: unknown): Acc {
  const rootAcc = newAcc()
  const stack: [unknown, Acc][] = [[root, rootAcc]]
  while (stack.length) {
    const [v, acc] = stack.pop()!
    acc.seen++
    const t = jsonTypeOf(v)
    acc.types.set(t, (acc.types.get(t) ?? 0) + 1)
    if (t === 'object') {
      acc.objectCount++
      acc.fields ??= new Map()
      for (const k of Object.keys(v as object)) {
        let f = acc.fields.get(k)
        if (!f) {
          if (acc.fields.size >= MAX_FIELDS) {
            acc.droppedKeys++
            continue
          }
          f = newAcc()
          acc.fields.set(k, f)
        }
        stack.push([(v as Record<string, unknown>)[k], f])
      }
    } else if (t === 'array') {
      acc.items ??= newAcc()
      const a = v as unknown[]
      for (let i = a.length - 1; i >= 0; i--) stack.push([a[i], acc.items])
    } else if (acc.examples.length < 3) {
      const p = preview(v, 48)
      if (!acc.examples.includes(p)) acc.examples.push(p)
    }
  }
  return rootAcc
}

function toShape(acc: Acc, key: string, path: string, parent?: Acc): ShapeNode {
  const node: ShapeNode = {
    key,
    path,
    types: Object.fromEntries(acc.types),
    seen: acc.seen,
    required: parent ? acc.seen >= parent.objectCount : true,
    examples: acc.examples,
  }
  if (parent) {
    node.presentIn = acc.seen
    node.parentCount = parent.objectCount
  }
  const children: ShapeNode[] = []
  if (acc.fields) for (const [k, f] of acc.fields) children.push(toShape(f, k, childPath(path, k), acc))
  if (acc.items) children.push(toShape(acc.items, '[]', `${path}[*]`))
  if (children.length) node.children = children
  if (acc.droppedKeys) node.truncatedKeys = acc.droppedKeys
  return node
}

export function inferShape(root: unknown): ShapeNode {
  return toShape(accumulate(root), '$', '$')
}

// ---------------------------------------------------------------------------
// Array statistics
// ---------------------------------------------------------------------------

export interface ValueStats {
  key: string
  present: number
  /** Share of items with this field (0–1). */
  presence: number
  types: Partial<Record<JsonType, number>>
  /** approx = some numbers exceed double precision; stats are floating-point estimates. */
  numeric?: { min: number; max: number; mean: number; count: number; approx?: boolean }
  /** Distinct primitive values (objects/arrays are not counted). */
  distinct: number
  distinctCapped: boolean
  top?: { value: string; count: number }[]
  nulls: number
}

export interface ArrayStats {
  path: string
  /** Number of arrays found at this (normalised) path. */
  arrays: number
  minLength: number
  maxLength: number
  totalItems: number
  itemTypes: Partial<Record<JsonType, number>>
  /** Per-field stats for object items, by descending presence. */
  fields: ValueStats[]
  /** Stats for primitive items (strings, numbers…). */
  values?: ValueStats
  truncatedFields?: boolean
}

interface StatAcc {
  present: number
  types: Map<JsonType, number>
  min: number
  max: number
  sum: number
  numCount: number
  distinct: Set<string>
  distinctCapped: boolean
  counts: Map<string, number>
  nulls: number
  approx: boolean
}

const MAX_DISTINCT = 5000

function newStat(): StatAcc {
  return { present: 0, types: new Map(), min: Infinity, max: -Infinity, sum: 0, numCount: 0, distinct: new Set(), distinctCapped: false, counts: new Map(), nulls: 0, approx: false }
}

function addStat(s: StatAcc, v: unknown) {
  s.present++
  const t = jsonTypeOf(v)
  s.types.set(t, (s.types.get(t) ?? 0) + 1)
  if (t === 'null') s.nulls++
  if (t === 'number') {
    const n = Number(numberText(v))
    if (isLosslessNumber(v)) s.approx = true
    if (Number.isFinite(n)) {
      if (n < s.min) s.min = n
      if (n > s.max) s.max = n
      s.sum += n
      s.numCount++
    }
  }
  if (t === 'object' || t === 'array') return
  const key = t === 'string' ? (v as string) : `\u0000${t}:${numberText(v)}`
  if (!s.distinctCapped) {
    s.distinct.add(key)
    if (s.distinct.size > MAX_DISTINCT) s.distinctCapped = true
  }
  if (t === 'string' || t === 'boolean') {
    const label = t === 'string' ? (v as string) : String(v)
    if (s.counts.has(label) || s.counts.size < MAX_DISTINCT) s.counts.set(label, (s.counts.get(label) ?? 0) + 1)
  }
}

function finishStat(key: string, s: StatAcc, total: number): ValueStats {
  const out: ValueStats = {
    key,
    present: s.present,
    presence: total ? s.present / total : 0,
    types: Object.fromEntries(s.types),
    distinct: s.distinct.size,
    distinctCapped: s.distinctCapped,
    nulls: s.nulls,
  }
  if (s.numCount) out.numeric = { min: s.min, max: s.max, mean: s.sum / s.numCount, count: s.numCount, ...(s.approx ? { approx: true } : {}) }
  if (s.counts.size) {
    out.top = [...s.counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 5)
      .map(([value, count]) => ({ value: value.length > 80 ? value.slice(0, 79) + '…' : value, count }))
  }
  return out
}

interface ArrAcc {
  arrays: number
  minLength: number
  maxLength: number
  totalItems: number
  itemTypes: Map<JsonType, number>
  objectItems: number
  fields: Map<string, StatAcc>
  values: StatAcc
  truncatedFields: boolean
}

export function computeArrayStats(root: unknown, maxArrays = 500): ArrayStats[] {
  const byPath = new Map<string, ArrAcc>()
  const stack: [unknown, string][] = [[root, '$']]
  while (stack.length) {
    const [v, path] = stack.pop()!
    if (Array.isArray(v)) {
      let a = byPath.get(path)
      if (!a) {
        if (byPath.size >= maxArrays) continue
        a = { arrays: 0, minLength: Infinity, maxLength: 0, totalItems: 0, itemTypes: new Map(), objectItems: 0, fields: new Map(), values: newStat(), truncatedFields: false }
        byPath.set(path, a)
      }
      a.arrays++
      a.minLength = Math.min(a.minLength, v.length)
      a.maxLength = Math.max(a.maxLength, v.length)
      a.totalItems += v.length
      const itemPath = `${path}[*]`
      for (const item of v) {
        const t = jsonTypeOf(item)
        a.itemTypes.set(t, (a.itemTypes.get(t) ?? 0) + 1)
        if (t === 'object') {
          a.objectItems++
          for (const [k, fv] of Object.entries(item as Record<string, unknown>)) {
            let f = a.fields.get(k)
            if (!f) {
              if (a.fields.size >= MAX_FIELDS) {
                a.truncatedFields = true
                continue
              }
              f = newStat()
              a.fields.set(k, f)
            }
            addStat(f, fv)
          }
        } else if (t !== 'array') addStat(a.values, item)
        if (t === 'object' || t === 'array') stack.push([item, itemPath])
      }
    } else if (isObj(v)) {
      for (const [k, cv] of Object.entries(v)) if (cv !== null && typeof cv === 'object') stack.push([cv, childPath(path, k)])
    }
  }
  const out: ArrayStats[] = []
  for (const [path, a] of byPath) {
    out.push({
      path,
      arrays: a.arrays,
      minLength: a.minLength === Infinity ? 0 : a.minLength,
      maxLength: a.maxLength,
      totalItems: a.totalItems,
      itemTypes: Object.fromEntries(a.itemTypes),
      fields: [...a.fields.entries()].map(([k, s]) => finishStat(k, s, a.objectItems)).sort((x, y) => y.present - x.present),
      values: a.values.present ? finishStat('(value)', a.values, a.totalItems - a.objectItems) : undefined,
      truncatedFields: a.truncatedFields || undefined,
    })
  }
  return out.sort((x, y) => (x.path < y.path ? -1 : 1))
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export interface PathEntry {
  path: string
  type: JsonType
  preview: string
}

export function listPaths(root: unknown, opts: { leafOnly?: boolean; normalized?: boolean; limit?: number } = {}): { paths: PathEntry[]; total: number } {
  const limit = opts.limit ?? 200_000
  const paths: PathEntry[] = []
  const seen = opts.normalized ? new Set<string>() : null
  let total = 0
  const stack: [unknown, string][] = [[root, '$']]
  while (stack.length) {
    const [v, path] = stack.pop()!
    const t = jsonTypeOf(v)
    const container = t === 'object' || t === 'array'
    const leaf = !container || (t === 'object' ? Object.keys(v as object).length === 0 : (v as unknown[]).length === 0)
    if (!opts.leafOnly || leaf) {
      if (!seen || !seen.has(path)) {
        seen?.add(path)
        total++
        if (paths.length < limit) paths.push({ path, type: t, preview: preview(v) })
      }
    }
    if (t === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
      for (let i = entries.length - 1; i >= 0; i--) stack.push([entries[i][1], childPath(path, entries[i][0])])
    } else if (t === 'array') {
      const a = v as unknown[]
      for (let i = a.length - 1; i >= 0; i--) stack.push([a[i], opts.normalized ? `${path}[*]` : `${path}[${i}]`])
    }
  }
  return { paths, total }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit {
  path: string
  key: string
  type: JsonType
  preview: string
  in: 'key' | 'value'
}

export function searchJson(
  root: unknown,
  query: string,
  opts: { keys?: boolean; values?: boolean; caseSensitive?: boolean; exact?: boolean; limit?: number } = {},
): { hits: SearchHit[]; total: number } {
  const keys = opts.keys ?? true
  const values = opts.values ?? true
  const limit = opts.limit ?? 5000
  const q = opts.caseSensitive ? query : query.toLowerCase()
  const hits: SearchHit[] = []
  let total = 0
  if (!query) return { hits, total }
  const test = (s: string) => {
    const x = opts.caseSensitive ? s : s.toLowerCase()
    return opts.exact ? x === q : x.includes(q)
  }
  const stack: [unknown, string, string][] = [[root, '$', '$']]
  while (stack.length) {
    const [v, path, key] = stack.pop()!
    const t = jsonTypeOf(v)
    if (keys && key !== '$' && !key.startsWith('[') && test(key)) {
      total++
      if (hits.length < limit) hits.push({ path, key, type: t, preview: preview(v), in: 'key' })
    }
    if (t === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
      for (let i = entries.length - 1; i >= 0; i--) stack.push([entries[i][1], childPath(path, entries[i][0]), entries[i][0]])
    } else if (t === 'array') {
      const a = v as unknown[]
      for (let i = a.length - 1; i >= 0; i--) stack.push([a[i], `${path}[${i}]`, `[${i}]`])
    } else if (values) {
      const s = t === 'string' ? (v as string) : t === 'number' ? numberText(v) : String(v)
      if (test(s)) {
        total++
        if (hits.length < limit) hits.push({ path, key, type: t, preview: preview(v), in: 'value' })
      }
    }
  }
  return { hits, total }
}

// ---------------------------------------------------------------------------
// Structural comparison
// ---------------------------------------------------------------------------

export interface CompareEntry {
  path: string
  type?: string
  from?: string
  to?: string
}

export interface CompareResult {
  mode: 'paths' | 'schema'
  counts: { added: number; removed: number; typeChanged: number; valueChanged: number; unchanged: number }
  added: CompareEntry[]
  removed: CompareEntry[]
  typeChanged: CompareEntry[]
  valueChanged: CompareEntry[]
}

interface FlatInfo {
  type: string
  value?: string
  parent: string | null
}

function flatten(root: unknown, normalized: boolean): Map<string, FlatInfo> {
  const out = new Map<string, FlatInfo>()
  const stack: [unknown, string, string | null][] = [[root, '$', null]]
  while (stack.length) {
    const [v, path, parent] = stack.pop()!
    const t = jsonTypeOf(v)
    const prev = out.get(path)
    if (prev) {
      if (!prev.type.split('|').includes(t)) prev.type = [...prev.type.split('|'), t].sort().join('|')
    } else out.set(path, { type: t, value: t === 'object' || t === 'array' ? undefined : t === 'string' ? JSON.stringify(v) : t === 'number' ? numberText(v) : String(v), parent })
    if (t === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
      for (let i = entries.length - 1; i >= 0; i--) stack.push([entries[i][1], childPath(path, entries[i][0]), path])
    } else if (t === 'array') {
      const arr = v as unknown[]
      for (let i = arr.length - 1; i >= 0; i--) stack.push([arr[i], normalized ? `${path}[*]` : `${path}[${i}]`, path])
    }
  }
  return out
}

const short = (s: string | undefined) => (s && s.length > 80 ? s.slice(0, 79) + '…' : s)

export function compareJson(a: unknown, b: unknown, mode: 'paths' | 'schema' = 'paths', cap = 2000): CompareResult {
  const fa = flatten(a, mode === 'schema')
  const fb = flatten(b, mode === 'schema')
  const res: CompareResult = { mode, counts: { added: 0, removed: 0, typeChanged: 0, valueChanged: 0, unchanged: 0 }, added: [], removed: [], typeChanged: [], valueChanged: [] }
  const reported = new Set<string>()
  const ancestorReported = (info: FlatInfo, map: Map<string, FlatInfo>) => {
    let p = info.parent
    while (p) {
      if (reported.has(p)) return true
      p = map.get(p)?.parent ?? null
    }
    return false
  }
  const ordered = (m: Map<string, FlatInfo>) => [...m.keys()]
  for (const path of ordered(fa)) {
    const ia = fa.get(path)!
    const ib = fb.get(path)
    if (!ib) {
      if (ancestorReported(ia, fa)) continue
      reported.add(path)
      res.counts.removed++
      if (res.removed.length < cap) res.removed.push({ path, type: ia.type, from: short(ia.value) })
    } else if (ia.type !== ib.type) {
      if (ancestorReported(ia, fa)) continue
      reported.add(path)
      res.counts.typeChanged++
      if (res.typeChanged.length < cap) res.typeChanged.push({ path, from: ia.type, to: ib.type })
    } else if (mode === 'paths' && ia.value !== ib.value) {
      res.counts.valueChanged++
      if (res.valueChanged.length < cap) res.valueChanged.push({ path, type: ia.type, from: short(ia.value), to: short(ib.value) })
    } else if (ia.value !== undefined || mode === 'schema') res.counts.unchanged++
  }
  for (const path of ordered(fb)) {
    if (fa.has(path)) continue
    const ib = fb.get(path)!
    if (ancestorReported(ib, fb)) continue
    reported.add(path)
    res.counts.added++
    if (res.added.length < cap) res.added.push({ path, type: ib.type, to: short(ib.value) })
  }
  return res
}

// ---------------------------------------------------------------------------
// One-shot analysis (worker task)
// ---------------------------------------------------------------------------

export interface AnalysisOk {
  ok: true
  envelope: Omit<HttpEnvelope, 'body'> | null
  bodyBytes: number
  hasBigNumbers: boolean
  rootType: JsonType
  overview: Overview
  shape: ShapeNode
  arrays: ArrayStats[]
}

export interface AnalysisErr {
  ok: false
  error: JsonErrorInfo
  envelope: Omit<HttpEnvelope, 'body'> | null
}

export type Analysis = AnalysisOk | AnalysisErr

export function parseResponse(text: string): { ok: true; value: unknown; hasBigNumbers: boolean; envelope: HttpEnvelope | null } | { ok: false; error: JsonErrorInfo; envelope: HttpEnvelope | null } {
  const env = splitHttpResponse(text)
  const envelope = env.statusLines.length || env.headers.length ? env : null
  const r = parseJson(env.body)
  if (!r.ok) {
    const error = { ...r.error }
    if (envelope) {
      error.line += env.bodyLineOffset
      error.offset += env.bodyOffset
    }
    return { ok: false, error, envelope }
  }
  return { ok: true, value: r.value, hasBigNumbers: r.hasBigNumbers, envelope }
}

export function analyzeResponse(text: string): Analysis {
  const p = parseResponse(text)
  const env = p.envelope ? { statusLines: p.envelope.statusLines, headers: p.envelope.headers, bodyLineOffset: p.envelope.bodyLineOffset, bodyOffset: p.envelope.bodyOffset } : null
  if (!p.ok) return { ok: false, error: p.error, envelope: env }
  const body = p.envelope ? p.envelope.body : text
  return {
    ok: true,
    envelope: env,
    bodyBytes: new TextEncoder().encode(body).length,
    hasBigNumbers: p.hasBigNumbers,
    rootType: jsonTypeOf(p.value),
    overview: computeOverview(p.value),
    shape: inferShape(p.value),
    arrays: computeArrayStats(p.value),
  }
}
