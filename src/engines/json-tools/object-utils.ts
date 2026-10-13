/**
 * Structural operations on JSON values: flatten / unflatten, deep key sorting, pruning,
 * key & value extraction, deep merge and structural ("schema") comparison.
 *
 * All functions are pure and LosslessNumber-aware: big numbers are treated as leaf numbers
 * and come out with their original digits.
 */
import { isLosslessNumber, jsonTypeOf, type JsonType } from '@/engines/json/parse'
import type { PathSegment } from './paths'
import { getOwn, setKey } from './util'

type Obj = Record<string, unknown>

export const isPlainObject = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v) && !isLosslessNumber(v)
const isContainer = (v: unknown): v is Obj | unknown[] => Array.isArray(v) || isPlainObject(v)

/** O(1) emptiness check (Object.keys would be O(n) per call). */
function isEmpty(v: Obj | unknown[]): boolean {
  if (Array.isArray(v)) return v.length === 0
  for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) return false
  return true
}

// ── Flatten ─────────────────────────────────────────────────────────────────

export interface FlattenOptions {
  /** Key separator. Default ".". */
  delimiter?: string
  /** Array index notation: `a.0.b` ("dot") or `a[0].b` ("bracket"). Default "dot". */
  arrays?: 'dot' | 'bracket'
  /** Stop flattening below this depth (0 = unlimited). Deeper values are kept as nested JSON. */
  maxDepth?: number
}

export interface FlattenResult {
  value: Obj
  /** Keys that contain the delimiter — these won't unflatten back to the same structure. */
  ambiguousKeys: string[]
  /** Distinct keys that collided after joining (later value wins). */
  collisions: string[]
}

export function flatten(value: unknown, opts: FlattenOptions = {}): FlattenResult {
  const d = opts.delimiter ?? '.'
  if (!d) throw new Error('The delimiter cannot be empty')
  const bracket = opts.arrays === 'bracket'
  const maxDepth = opts.maxDepth && opts.maxDepth > 0 ? opts.maxDepth : Infinity
  const out: Obj = {}
  const ambiguous = new Set<string>()
  const collisions = new Set<string>()
  const put = (k: string, v: unknown) => {
    if (Object.prototype.hasOwnProperty.call(out, k)) collisions.add(k)
    setKey(out, k, v)
  }
  const walk = (v: unknown, prefix: string, depth: number) => {
    if (!isContainer(v) || depth >= maxDepth) {
      put(prefix, v)
      return
    }
    if (Array.isArray(v)) {
      if (v.length === 0) return put(prefix, [])
      v.forEach((x, i) => walk(x, bracket ? `${prefix}[${i}]` : prefix ? `${prefix}${d}${i}` : String(i), depth + 1))
      return
    }
    const keys = Object.keys(v)
    if (keys.length === 0) return put(prefix, {})
    for (const k of keys) {
      if (k.includes(d) || (bracket && /\[\d+\]/.test(k))) ambiguous.add(k)
      walk(v[k], prefix ? `${prefix}${d}${k}` : k, depth + 1)
    }
  }
  if (!isContainer(value)) throw new Error('Flatten needs a JSON object or array at the top level')
  if (Array.isArray(value) && value.length === 0) return { value: {}, ambiguousKeys: [], collisions: [] }
  if (isPlainObject(value) && Object.keys(value).length === 0) return { value: {}, ambiguousKeys: [], collisions: [] }
  walk(value, '', 0)
  return { value: out, ambiguousKeys: [...ambiguous], collisions: [...collisions] }
}

export interface UnflattenOptions {
  delimiter?: string
  /** Turn numeric segments (`a.0`, `a[0]`) into array indices. Default true. */
  numericArrays?: boolean
}

/** Splits a flat key into segments, understanding both `a.0.b` and `a[0].b`. */
export function splitFlatKey(key: string, delimiter: string, numericArrays: boolean): PathSegment[] {
  const segs: PathSegment[] = []
  for (const part of key.split(delimiter)) {
    // Peel bracket indices: users[0][1] → users, 0, 1
    const m = part.match(/^(.*?)((?:\[\d+\])+)$/)
    if (m && (m[1] !== '' || segs.length > 0 || part.startsWith('['))) {
      if (m[1] !== '') segs.push(m[1])
      for (const ix of m[2].matchAll(/\[(\d+)\]/g)) segs.push(numericArrays ? Number(ix[1]) : ix[1])
    } else if (numericArrays && /^(0|[1-9]\d*)$/.test(part)) segs.push(Number(part))
    else segs.push(part)
  }
  return segs
}

export function unflatten(value: unknown, opts: UnflattenOptions = {}): unknown {
  const d = opts.delimiter ?? '.'
  if (!d) throw new Error('The delimiter cannot be empty')
  const numeric = opts.numericArrays ?? true
  if (!isPlainObject(value)) throw new Error('Unflatten needs a flat JSON object, e.g. {"user.name": "Ada"}')
  const keys = Object.keys(value)
  if (keys.length === 0) return {}
  let root: unknown = undefined
  const describe = (segs: PathSegment[], n: number) => segs.slice(0, n).join(d) || '(root)'
  for (const key of keys) {
    const segs = splitFlatKey(key, d, numeric)
    if (root === undefined) root = typeof segs[0] === 'number' ? [] : {}
    if (typeof segs[0] === 'number' !== Array.isArray(root)) {
      throw new Error(`Key "${key}" conflicts with other keys: the top level cannot be both an array and an object`)
    }
    let cur = root as Obj | unknown[]
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      const last = i === segs.length - 1
      const slot = Array.isArray(cur) ? cur[s as number] : getOwn(cur, s as string)
      if (last) {
        if (slot !== undefined && isContainer(slot) && !(isContainer(value[key]) && isEmpty(value[key] as Obj))) {
          throw new Error(`Key "${key}" conflicts with nested keys under "${describe(segs, i + 1)}"`)
        }
        if (Array.isArray(cur)) cur[s as number] = value[key]
        else setKey(cur, s as string, value[key])
      } else {
        const wantArray = typeof segs[i + 1] === 'number'
        if (slot === undefined || (isContainer(slot) && isEmpty(slot) && Array.isArray(slot) !== wantArray)) {
          if (Array.isArray(cur)) cur[s as number] = wantArray ? [] : {}
          else setKey(cur, s as string, wantArray ? [] : {})
        } else if (!isContainer(slot)) {
          throw new Error(`Key "${key}" conflicts with "${describe(segs, i + 1)}", which already holds a value`)
        } else if (Array.isArray(slot) !== wantArray) {
          throw new Error(`Key "${key}" conflicts with other keys: "${describe(segs, i + 1)}" cannot be both an array and an object`)
        }
        cur = (Array.isArray(cur) ? cur[s as number] : getOwn(cur, s as string)) as Obj | unknown[]
      }
    }
  }
  return fillHoles(root)
}

/** Sparse arrays (a.0 and a.2 but no a.1) get explicit nulls — JSON has no holes. */
function fillHoles(v: unknown): unknown {
  if (Array.isArray(v)) {
    const out = new Array(v.length)
    for (let i = 0; i < v.length; i++) out[i] = i in v ? fillHoles(v[i]) : null
    return out
  }
  if (isPlainObject(v)) for (const k of Object.keys(v)) setKey(v, k, fillHoles(v[k]))
  return v
}

// ── Sort keys ───────────────────────────────────────────────────────────────

export interface SortOptions {
  order?: 'asc' | 'desc'
  /** natural: "item2" < "item10", case-insensitive; codepoint: plain string order. */
  collation?: 'natural' | 'codepoint'
  /** Sort nested objects too (default true). */
  deep?: boolean
}

const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function sortKeys(value: unknown, opts: SortOptions = {}): unknown {
  const deep = opts.deep ?? true
  const cmp = opts.collation === 'codepoint' ? (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0) : (a: string, b: string) => natural.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
  const dir = opts.order === 'desc' ? -1 : 1
  const visit = (v: unknown, top: boolean): unknown => {
    if (Array.isArray(v)) return deep || top ? v.map((x) => (deep ? visit(x, false) : x)) : v
    if (!isPlainObject(v)) return v
    if (!deep && !top) return v
    const out: Obj = {}
    for (const k of Object.keys(v).sort((a, b) => dir * cmp(a, b))) setKey(out, k, deep ? visit(v[k], false) : v[k])
    return out
  }
  return visit(value, true)
}

// ── Prune ───────────────────────────────────────────────────────────────────

export interface PruneOptions {
  null?: boolean
  emptyString?: boolean
  emptyArray?: boolean
  emptyObject?: boolean
  /** Also remove matching elements from arrays (default false: only object fields). */
  inArrays?: boolean
  /** Remove containers that become empty after pruning (default true when removing empties). */
  cascade?: boolean
}

export function prune(value: unknown, opts: PruneOptions): { value: unknown; removed: number } {
  let removed = 0
  const cascade = opts.cascade ?? true
  const shouldRemove = (v: unknown): boolean => {
    if (v === null) return !!opts.null
    if (v === '') return !!opts.emptyString
    if (Array.isArray(v)) return !!opts.emptyArray && v.length === 0
    if (isPlainObject(v)) return !!opts.emptyObject && Object.keys(v).length === 0
    return false
  }
  const isEmptyContainer = (v: unknown) => (Array.isArray(v) ? v.length === 0 : isPlainObject(v) && Object.keys(v).length === 0)
  // Without cascade, only values that were already empty/null are removed — not containers emptied by pruning.
  const removable = (before: unknown, after: unknown) => shouldRemove(after) && (cascade || !isContainer(before) || isEmptyContainer(before))
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const out: unknown[] = []
      for (const x of v) {
        const nx = visit(x)
        if (opts.inArrays && removable(x, nx)) removed++
        else out.push(nx)
      }
      return out
    }
    if (isPlainObject(v)) {
      const out: Obj = {}
      for (const k of Object.keys(v)) {
        const nx = visit(v[k])
        if (removable(v[k], nx)) removed++
        else setKey(out, k, nx)
      }
      return out
    }
    return v
  }
  return { value: visit(value), removed }
}

// ── Extract ─────────────────────────────────────────────────────────────────

export interface ExtractKeysOptions {
  /** Merge array indices into `[]` so each distinct shape path is listed once (default true). */
  collapseIndices?: boolean
  /** Only paths that end at a primitive (default false = every key path). */
  leavesOnly?: boolean
  delimiter?: string
}

export function extractKeyPaths(value: unknown, opts: ExtractKeysOptions = {}): string[] {
  const collapse = opts.collapseIndices ?? true
  const d = opts.delimiter ?? '.'
  const seen = new Set<string>()
  const out: string[] = []
  const add = (p: string) => {
    if (p && !seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  const walk = (v: unknown, prefix: string) => {
    if (Array.isArray(v)) {
      if (!opts.leavesOnly || v.length === 0) add(prefix)
      v.forEach((x, i) => walk(x, `${prefix}[${collapse ? '' : i}]`))
    } else if (isPlainObject(v)) {
      const keys = Object.keys(v)
      if (!opts.leavesOnly || keys.length === 0) add(prefix)
      for (const k of keys) walk(v[k], prefix ? `${prefix}${d}${k}` : k)
    } else add(prefix)
  }
  walk(value, '')
  return out
}

export function extractLeafValues(value: unknown, opts: { unique?: boolean } = {}): unknown[] {
  const out: unknown[] = []
  const seen = new Set<string>()
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (isPlainObject(v)) for (const k of Object.keys(v)) walk(v[k])
    else {
      if (opts.unique) {
        const key = jsonTypeOf(v) + ':' + (isLosslessNumber(v) ? (v as { value: string }).value : String(v))
        if (seen.has(key)) return
        seen.add(key)
      }
      out.push(v)
    }
  }
  walk(value)
  return out
}

// ── Merge ───────────────────────────────────────────────────────────────────

export type ArrayMergeStrategy = 'replace' | 'concat' | 'index'

export interface MergeOptions {
  arrays?: ArrayMergeStrategy
  /** When B has null for a key, keep A's value instead of overwriting. Default false. */
  skipNulls?: boolean
}

/** Deep merge: B wins on conflicts; objects merge recursively; arrays per strategy. */
export function deepMerge(a: unknown, b: unknown, opts: MergeOptions = {}): unknown {
  const arrays = opts.arrays ?? 'replace'
  if (b === undefined) return a
  if (b === null && opts.skipNulls && a !== undefined) return a
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Obj = {}
    for (const k of Object.keys(a)) setKey(out, k, a[k])
    for (const k of Object.keys(b)) setKey(out, k, Object.prototype.hasOwnProperty.call(a, k) ? deepMerge(a[k], b[k], opts) : b[k])
    return out
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (arrays === 'concat') return [...a, ...b]
    if (arrays === 'index') {
      const n = Math.max(a.length, b.length)
      const out: unknown[] = []
      for (let i = 0; i < n; i++) out.push(i < b.length ? (i < a.length ? deepMerge(a[i], b[i], opts) : b[i]) : a[i])
      return out
    }
    return b
  }
  return b
}

// ── Structural comparison ───────────────────────────────────────────────────

/** Map of key path (array indices collapsed to `[]`) → set of JSON types seen there. */
export function structureOf(value: unknown): Map<string, Set<JsonType>> {
  const m = new Map<string, Set<JsonType>>()
  const add = (p: string, t: JsonType) => {
    let s = m.get(p)
    if (!s) m.set(p, (s = new Set()))
    s.add(t)
  }
  const walk = (v: unknown, p: string) => {
    add(p || '$', jsonTypeOf(v))
    if (Array.isArray(v)) v.forEach((x) => walk(x, `${p}[]`))
    else if (isPlainObject(v)) for (const k of Object.keys(v)) walk(v[k], p ? `${p}.${k}` : k)
  }
  walk(value, '')
  return m
}

export interface StructureDiffEntry {
  path: string
  kind: 'onlyA' | 'onlyB' | 'typeChanged' | 'same'
  typesA: JsonType[]
  typesB: JsonType[]
}

export interface StructureDiff {
  entries: StructureDiffEntry[]
  onlyA: number
  onlyB: number
  typeChanged: number
  same: number
}

const typeList = (s: Set<JsonType> | undefined) => (s ? [...s].sort() : [])

export function compareStructure(a: unknown, b: unknown): StructureDiff {
  const sa = structureOf(a)
  const sb = structureOf(b)
  const order: string[] = []
  const seen = new Set<string>()
  for (const k of [...sa.keys(), ...sb.keys()]) if (!seen.has(k)) seen.add(k), order.push(k)
  const entries: StructureDiffEntry[] = []
  const counts = { onlyA: 0, onlyB: 0, typeChanged: 0, same: 0 }
  for (const p of order) {
    const ta = typeList(sa.get(p))
    const tb = typeList(sb.get(p))
    const kind: StructureDiffEntry['kind'] = !tb.length ? 'onlyA' : !ta.length ? 'onlyB' : ta.join() !== tb.join() ? 'typeChanged' : 'same'
    counts[kind]++
    entries.push({ path: p, kind, typesA: ta, typesB: tb })
  }
  return { entries, ...counts }
}

/** Plain-text report of a structural comparison. */
export function formatStructureDiff(d: StructureDiff, includeSame = false): string {
  const lines: string[] = []
  const sym = { onlyA: '-', onlyB: '+', typeChanged: '~', same: ' ' }
  for (const e of d.entries) {
    if (e.kind === 'same' && !includeSame) continue
    const types = e.kind === 'typeChanged' ? `${e.typesA.join(' | ')} → ${e.typesB.join(' | ')}` : (e.kind === 'onlyB' ? e.typesB : e.typesA).join(' | ')
    lines.push(`${sym[e.kind]} ${e.path}  (${types})`)
  }
  return lines.join('\n')
}
