/**
 * JSON → CSV: locate the record array, flatten records into columns, serialize.
 */
import { isLosslessNumber, parseJson, type JsonErrorInfo } from '@/engines/json/parse'
import { stringifyJson } from '@/engines/json/stringify'
import { serializeCsv, type LineEnding, type QuoteStyle } from './csv'

export type ArrayMode = 'join' | 'json' | 'expand'
export type PathSegment = string | number

export interface ColumnSelection {
  /** Flattened keys to leave out. */
  exclude: string[]
  /** Flattened key → header text. */
  rename: Record<string, string>
}

export interface JsonToCsvOptions {
  /** Path to the record array. `null` = choose automatically. */
  path: PathSegment[] | null
  flatten: boolean
  /** Joins nested keys: `a.b`. */
  separator: string
  /** Levels of nesting to flatten (0 = unlimited). Deeper values are JSON-encoded. */
  maxDepth: number
  arrays: ArrayMode
  /** Separator used by the `join` array mode. */
  joinWith: string
  sortColumns: boolean
  delimiter: string
  quote: QuoteStyle
  header: boolean
  lineEnding: LineEnding
  /** Text written for JSON null. */
  nullText: string
  /** Text written when a record lacks a column. */
  missingText: string
  /** Prefix `'` to string values starting with = + - @ (spreadsheet formula injection). */
  escapeFormulas: boolean
  columns: ColumnSelection
}

export const DEFAULT_JSON_TO_CSV: JsonToCsvOptions = {
  path: null,
  flatten: true,
  separator: '.',
  maxDepth: 0,
  arrays: 'join',
  joinWith: '; ',
  sortColumns: false,
  delimiter: ',',
  quote: 'minimal',
  header: true,
  lineEnding: 'lf',
  nullText: '',
  missingText: '',
  escapeFormulas: false,
  columns: { exclude: [], rename: {} },
}

/** A cell: text, `null` for JSON null, `undefined` when the record lacks the column. */
export type Cell = string | null | undefined

export type ValueKind = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'

export interface ColumnInfo {
  key: string
  /** Header text after renaming. */
  header: string
  included: boolean
  /** Number of records that have this column. */
  present: number
  kinds: ValueKind[]
}

export interface ArrayCandidate {
  path: PathSegment[]
  label: string
  length: number
  /** Share of elements that are objects (0–1). */
  objectShare: number
}

export interface CsvTable {
  /** Included column keys in output order. */
  keys: string[]
  headers: string[]
  rows: Cell[][]
}

export interface JsonToCsvResult {
  ok: true
  csv: string
  table: CsvTable
  columns: ColumnInfo[]
  candidates: ArrayCandidate[]
  path: PathSegment[]
  recordCount: number
  warnings: string[]
}

export type JsonToCsvOutcome = JsonToCsvResult | { ok: false; error: JsonErrorInfo | { message: string; line?: number; column?: number } }

// ── Locating records ─────────────────────────────────────────────────────────

export function formatPath(path: PathSegment[]): string {
  if (!path.length) return '$'
  let s = '$'
  for (const p of path) s += typeof p === 'number' ? `[${p}]` : /^[A-Za-z_$][\w$]*$/.test(p) ? `.${p}` : `[${JSON.stringify(p)}]`
  return s
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !isLosslessNumber(v)

export function getAtPath(value: unknown, path: PathSegment[]): unknown {
  let v = value
  for (const p of path) {
    if (v === null || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[p as string]
  }
  return v
}

/**
 * Finds arrays that could hold the records (breadth-first, up to `maxDepth` levels).
 * Arrays of objects rank first, then larger arrays.
 */
export function findArrayCandidates(root: unknown, maxDepth = 4, limit = 40): ArrayCandidate[] {
  const out: ArrayCandidate[] = []
  const queue: { v: unknown; path: PathSegment[] }[] = [{ v: root, path: [] }]
  while (queue.length && out.length < limit) {
    const { v, path } = queue.shift()!
    if (Array.isArray(v)) {
      let objects = 0
      for (const el of v) if (isPlainObject(el)) objects++
      out.push({ path, label: formatPath(path), length: v.length, objectShare: v.length ? objects / v.length : 0 })
      continue // records inside records aren't separate candidates
    }
    if (isPlainObject(v) && path.length < maxDepth) {
      for (const k of Object.keys(v)) queue.push({ v: v[k], path: [...path, k] })
    }
  }
  // Arrays of objects first, then shallower paths; otherwise document order (sort is stable).
  return out.sort((a, b) => (b.objectShare > 0.5 ? 1 : 0) - (a.objectShare > 0.5 ? 1 : 0) || a.path.length - b.path.length)
}

/** Default record source: the root array, else the best nested array of objects, else the root itself. */
export function chooseDefaultPath(root: unknown, candidates: ArrayCandidate[]): PathSegment[] {
  if (Array.isArray(root)) return []
  const objs = candidates.filter((c) => c.objectShare > 0.5 && c.length > 0)
  if (objs.length) return objs[0].path
  return []
}

// ── Flattening ───────────────────────────────────────────────────────────────

interface FlattenCtx {
  opts: JsonToCsvOptions
  out: Map<string, Cell>
  kinds: Map<string, ValueKind>
}

function kindOfValue(v: unknown): ValueKind {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (isLosslessNumber(v)) return 'number'
  const t = typeof v
  if (t === 'object') return 'object'
  if (t === 'number' || t === 'bigint') return 'number'
  if (t === 'boolean') return 'boolean'
  return 'string'
}

const FORMULA = /^[=+\-@\t\r]/

function scalarText(v: unknown, opts: JsonToCsvOptions): Cell {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return opts.escapeFormulas && FORMULA.test(v) ? `'${v}` : v
  if (isLosslessNumber(v)) return (v as { value: string }).value
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null
  return String(v)
}

const json = (v: unknown) => stringifyJson(v)

function set(ctx: FlattenCtx, key: string, cell: Cell, kind: ValueKind) {
  if (ctx.out.has(key)) {
    // Two paths flattened to the same key (e.g. {"a.b":1,"a":{"b":2}}): keep both, never drop.
    let n = 2
    while (ctx.out.has(`${key}~${n}`)) n++
    key = `${key}~${n}`
  }
  ctx.out.set(key, cell)
  ctx.kinds.set(key, kind)
}

/**
 * Writes `value` under `key`. `level` = nesting level of `key` (0 for top-level keys).
 */
function flattenValue(ctx: FlattenCtx, key: string, value: unknown, level: number) {
  const { opts } = ctx
  const canDescend = opts.flatten && (opts.maxDepth === 0 || level < opts.maxDepth)
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (!canDescend || !keys.length) {
      set(ctx, key, json(value), 'object')
      return
    }
    for (const k of keys) flattenValue(ctx, `${key}${opts.separator}${k}`, value[k], level + 1)
    return
  }
  if (Array.isArray(value)) {
    if (opts.arrays === 'expand' && canDescend && value.length) {
      for (let i = 0; i < value.length; i++) flattenValue(ctx, `${key}[${i}]`, value[i], level + 1)
      return
    }
    if (opts.arrays === 'join') {
      const parts = value.map((el) => (isPlainObject(el) || Array.isArray(el) ? json(el) : (scalarText(el, { ...opts, escapeFormulas: false }) ?? opts.nullText)))
      const joined = parts.join(opts.joinWith)
      set(ctx, key, opts.escapeFormulas && FORMULA.test(joined) ? `'${joined}` : joined, 'array')
      return
    }
    set(ctx, key, json(value), 'array')
    return
  }
  set(ctx, key, scalarText(value, opts), kindOfValue(value))
}

/** Flattens one record into ordered key → cell pairs. */
export function flattenRecord(record: unknown, opts: JsonToCsvOptions): { cells: Map<string, Cell>; kinds: Map<string, ValueKind> } {
  const ctx: FlattenCtx = { opts, out: new Map(), kinds: new Map() }
  if (isPlainObject(record)) {
    for (const k of Object.keys(record)) flattenValue(ctx, k, record[k], 0)
  } else if (Array.isArray(record)) {
    // Arrays as rows: each element becomes a positional column.
    for (let i = 0; i < record.length; i++) flattenValue(ctx, `column_${i + 1}`, record[i], 0)
  } else {
    flattenValue(ctx, 'value', record, 0)
  }
  return { cells: ctx.out, kinds: ctx.kinds }
}

/**
 * Column order: union of keys in first-seen order. A key first seen in a later record is
 * inserted right after the key that precedes it in that record (so `tags[2]` lands next
 * to `tags[1]` rather than at the far end); a new key that starts a record is appended.
 */
class KeyOrder {
  private next = new Map<string, string | null>()
  private head: string | null = null
  private tail: string | null = null
  has(k: string) {
    return this.next.has(k)
  }
  /** Inserts after `prev`, or appends when there is no previous key. */
  insertAfter(prev: string | null, k: string) {
    const at = prev ?? this.tail
    if (at === null) {
      this.next.set(k, null)
      this.head = this.tail = k
      return
    }
    const after = this.next.get(at) ?? null
    this.next.set(at, k)
    this.next.set(k, after)
    if (this.tail === at) this.tail = k
  }
  toArray(): string[] {
    const out: string[] = []
    for (let k = this.head; k !== null; k = this.next.get(k) ?? null) out.push(k)
    return out
  }
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Converts a parsed JSON value into a table. */
export function jsonValueToTable(root: unknown, opts: JsonToCsvOptions): Omit<JsonToCsvResult, 'csv' | 'ok'> {
  const candidates = findArrayCandidates(root)
  const warnings: string[] = []
  let path = opts.path ?? chooseDefaultPath(root, candidates)
  let source = getAtPath(root, path)
  if (source === undefined) {
    const fallback = chooseDefaultPath(root, candidates)
    warnings.push(`${formatPath(path)} does not exist in this document — using ${formatPath(fallback)} instead.`)
    path = fallback
    source = getAtPath(root, path)
  }
  const records = Array.isArray(source) ? source : [source]

  const order = new KeyOrder()
  const present = new Map<string, number>()
  const kinds = new Map<string, Set<ValueKind>>()
  const flat: Map<string, Cell>[] = new Array(records.length)
  for (let r = 0; r < records.length; r++) {
    const { cells, kinds: k } = flattenRecord(records[r], opts)
    flat[r] = cells
    let prev: string | null = null
    for (const key of cells.keys()) {
      if (!order.has(key)) order.insertAfter(prev, key)
      present.set(key, (present.get(key) ?? 0) + 1)
      let ks = kinds.get(key)
      if (!ks) kinds.set(key, (ks = new Set()))
      ks.add(k.get(key)!)
      prev = key
    }
  }

  let allKeys = order.toArray()
  if (opts.sortColumns) allKeys = [...allKeys].sort(collator.compare)

  const exclude = new Set(opts.columns.exclude)
  const columns: ColumnInfo[] = allKeys.map((key) => ({
    key,
    header: opts.columns.rename[key]?.trim() ? opts.columns.rename[key] : key,
    included: !exclude.has(key),
    present: present.get(key) ?? 0,
    kinds: [...(kinds.get(key) ?? [])],
  }))
  const included = columns.filter((c) => c.included)
  const keys = included.map((c) => c.key)
  const headers = included.map((c) => c.header)

  const dupes = headers.filter((h, i) => headers.indexOf(h) !== i)
  if (dupes.length) warnings.push(`Duplicate header ${[...new Set(dupes)].map((d) => `“${d}”`).join(', ')} — rename one of the columns.`)
  if (!Array.isArray(source)) warnings.push(`${formatPath(path)} is not an array — wrote it as a single row.`)
  if (records.length && keys.length === 0 && allKeys.length > 0) warnings.push('Every column is excluded.')

  const rows: Cell[][] = new Array(records.length)
  for (let r = 0; r < records.length; r++) {
    const cells = flat[r]
    const row: Cell[] = new Array(keys.length)
    for (let c = 0; c < keys.length; c++) row[c] = cells.has(keys[c]) ? cells.get(keys[c]) : undefined
    rows[r] = row
  }

  return { table: { keys, headers, rows }, columns, candidates, path, recordCount: records.length, warnings }
}

/** Renders a table as CSV text (without BOM — callers add it on download). */
export function tableToCsv(table: CsvTable, opts: Pick<JsonToCsvOptions, 'delimiter' | 'quote' | 'header' | 'lineEnding' | 'nullText' | 'missingText'>): string {
  if (!table.keys.length) return ''
  const body: string[][] = new Array(table.rows.length + (opts.header ? 1 : 0))
  let i = 0
  if (opts.header) body[i++] = table.headers
  for (const row of table.rows) {
    const out: string[] = new Array(row.length)
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      out[c] = v === undefined ? opts.missingText : v === null ? opts.nullText : v
    }
    body[i++] = out
  }
  return serializeCsv(body, { delimiter: opts.delimiter, quote: opts.quote, lineEnding: opts.lineEnding })
}

export function jsonToCsv(text: string, opts: JsonToCsvOptions = DEFAULT_JSON_TO_CSV): JsonToCsvOutcome {
  const parsed = parseJson(text)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  if (!opts.delimiter) return { ok: false, error: { message: 'The delimiter cannot be empty.' } }
  if (opts.flatten && !opts.separator) return { ok: false, error: { message: 'The key separator cannot be empty.' } }
  const t = jsonValueToTable(parsed.value, opts)
  return { ok: true, csv: tableToCsv(t.table, opts), ...t }
}
