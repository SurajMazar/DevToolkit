/**
 * Columnar dataset for the CSV viewer.
 *
 * Each column is stored "packed": all cells concatenated into one string plus an offsets
 * array (cell i = text.slice(offsets[i], offsets[i + 1])). Compared with millions of small
 * strings this is ~10× smaller, crosses the worker boundary as a single memcpy, and lets
 * the global filter scan a whole column with one regex.
 */
import Papa from 'papaparse'
import { detectDelimiter, detectLinebreak, inferValue, looksNumeric, normalizeHeaders, serializeCsv, DEFAULT_INFER, type CsvIssue, type InferOptions } from './csv'
import { stringifyJson } from '@/engines/json/stringify'

export interface PackedColumn {
  text: string
  /** Length rowCount + 1. */
  offsets: Uint32Array
}

export type ColumnType = 'integer' | 'decimal' | 'boolean' | 'date' | 'text' | 'empty'

export interface ColumnStats {
  type: ColumnType
  /** Non-empty values that match the type (for text: all non-empty). */
  typed: number
  empty: number
  unique: number
  /** Unique counting stopped at UNIQUE_CAP. */
  uniqueCapped: boolean
  /** Numeric / date min & max as display text. */
  min?: string
  max?: string
  minLength: number
  maxLength: number
}

export interface Dataset {
  headers: string[]
  columns: PackedColumn[]
  /** Sort/compare keys for numeric and date columns (NaN where not a value). */
  numeric: (Float64Array | null)[]
  stats: ColumnStats[]
  rowCount: number
  delimiter: string
  delimiterDetected: boolean
  linebreak: string
  issues: CsvIssue[]
  /** Rows whose field count differed from the header. */
  raggedRows: number
  bytes: number
  parseMs: number
}

export interface DatasetOptions {
  delimiter: string
  quoteChar: string
  header: boolean
  skipEmptyLines: boolean
}

export const UNIQUE_CAP = 1_000_000

export function cellAt(col: PackedColumn, row: number): string {
  return col.text.slice(col.offsets[row], col.offsets[row + 1])
}

class ColumnBuilder {
  parts: string[] = []
  offsets: number[] = [0]
  length = 0
  push(s: string) {
    this.parts.push(s)
    this.length += s.length
    this.offsets.push(this.length)
  }
  pad(n: number) {
    for (let i = 0; i < n; i++) this.offsets.push(this.length)
  }
  build(): PackedColumn {
    return { text: this.parts.join(''), offsets: Uint32Array.from(this.offsets) }
  }
}

const RE_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
const RE_NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/

/** Parses a cell as a number for sorting/filtering (more lenient than JSON inference). */
export function toNumber(s: string): number {
  const t = s.trim()
  return t && RE_NUM.test(t) ? Number(t) : NaN
}

export function toDate(s: string): number {
  const t = s.trim()
  if (!RE_DATE.test(t)) return NaN
  // Date-only and zone-less timestamps are compared as UTC so results don't depend on the viewer's zone.
  if (t.length === 10) return Date.parse(`${t}T00:00:00Z`)
  const iso = t.replace(' ', 'T')
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`)
}

function analyze(col: PackedColumn, rows: number): { stats: ColumnStats; numeric: Float64Array | null } {
  let empty = 0
  let ints = 0
  let decs = 0
  let bools = 0
  let dates = 0
  let minLength = Infinity
  let maxLength = 0
  const uniq = new Set<string>()
  let capped = false
  const nums = new Float64Array(rows)
  const ds = new Float64Array(rows)
  for (let i = 0; i < rows; i++) {
    const s = cellAt(col, i)
    if (!capped) {
      uniq.add(s)
      if (uniq.size >= UNIQUE_CAP) capped = true
    }
    const t = s.trim()
    if (!t) {
      empty++
      nums[i] = NaN
      ds[i] = NaN
      continue
    }
    if (s.length < minLength) minLength = s.length
    if (s.length > maxLength) maxLength = s.length
    const n = RE_NUM.test(t) ? Number(t) : NaN
    nums[i] = n
    if (!Number.isNaN(n)) {
      if (Number.isInteger(n) && !/[.eE]/.test(t)) ints++
      else decs++
    }
    const lower = t.length <= 5 ? t.toLowerCase() : ''
    if (lower === 'true' || lower === 'false') bools++
    const d = Number.isNaN(n) ? toDate(t) : NaN
    ds[i] = d
    if (!Number.isNaN(d)) dates++
  }
  const filled = rows - empty
  let type: ColumnType = 'text'
  let typed = filled
  let numeric: Float64Array | null = null
  if (!filled) type = 'empty'
  else if (ints + decs === filled) {
    type = decs ? 'decimal' : 'integer'
    numeric = nums
  } else if (bools === filled) type = 'boolean'
  else if (dates === filled) {
    type = 'date'
    numeric = ds
  }
  if (type === 'text') typed = filled
  let min: string | undefined
  let max: string | undefined
  if (numeric) {
    let lo = Infinity
    let hi = -Infinity
    let loIdx = -1
    let hiIdx = -1
    for (let i = 0; i < rows; i++) {
      const v = numeric[i]
      if (v < lo) {
        lo = v
        loIdx = i
      }
      if (v > hi) {
        hi = v
        hiIdx = i
      }
    }
    // Show the values as written in the file.
    if (loIdx >= 0) min = cellAt(col, loIdx).trim()
    if (hiIdx >= 0) max = cellAt(col, hiIdx).trim()
  }
  if (minLength === Infinity) minLength = 0
  return { stats: { type, typed, empty, unique: uniq.size, uniqueCapped: capped, min, max, minLength, maxLength }, numeric }
}

export interface ProgressInfo {
  phase: 'reading' | 'parsing' | 'analyzing'
  /** 0–1 */
  progress: number
  rows: number
}

/**
 * Parses CSV text into a packed dataset. `onProgress` is called every ~1 MB.
 * Field-count mismatches are padded (short rows) or extend the header (long rows).
 */
export function buildDataset(input: string, opts: DatasetOptions, onProgress?: (p: ProgressInfo) => void): Dataset {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const quoteChar = opts.quoteChar || '"'
  let delimiter = opts.delimiter
  let delimiterDetected = false
  if (!delimiter) {
    delimiter = detectDelimiter(text, quoteChar).delimiter
    delimiterDetected = true
  }
  const linebreak = detectLinebreak(text)
  const builders: ColumnBuilder[] = []
  let headerRaw: string[] | null = null
  let rowCount = 0
  let width = 0
  let ragged = 0
  let firstRagged: number | undefined
  const issues: CsvIssue[] = []
  const seenErr = new Set<string>()
  let recordNo = 0

  /** Field count every row should have: the header's, or the first data row's. */
  let refWidth = -1
  const addRow = (row: string[]) => {
    recordNo++
    if (opts.skipEmptyLines && row.length === 1 && row[0] === '') return
    if (opts.header && headerRaw === null) {
      headerRaw = row
      width = refWidth = row.length
      for (let c = 0; c < width; c++) builders.push(new ColumnBuilder())
      return
    }
    if (refWidth === -1) refWidth = row.length
    else if (row.length !== refWidth) {
      ragged++
      firstRagged ??= recordNo
    }
    if (row.length > width) {
      for (let c = width; c < row.length; c++) {
        const b = new ColumnBuilder()
        b.pad(rowCount)
        builders.push(b)
      }
      width = row.length
    }
    for (let c = 0; c < width; c++) builders[c].push(c < row.length ? row[c] : '')
    rowCount++
  }

  // A final line break ends the last record rather than starting an empty one.
  const body = text.replace(/(?:\r\n|\n|\r)$/, '')
  const total = body.length
  const parsed = Papa.parse<string[]>(body, {
    delimiter,
    quoteChar,
    newline: linebreak as '\n',
    skipEmptyLines: false,
    chunkSize: 1 << 20,
    chunk: (res: Papa.ParseResult<string[]>) => {
      for (const row of res.data) addRow(row)
      for (const e of res.errors) {
        if (e.code === 'UndetectableDelimiter') continue
        const key = `${e.code}:${e.row}`
        if (seenErr.has(key) || issues.length > 50) continue
        seenErr.add(key)
        issues.push({ severity: 'error', code: e.code, message: e.code === 'MissingQuotes' ? 'Quoted field is never closed — the rest of the file was read into one field' : e.message, row: recordNo })
      }
      onProgress?.({ phase: 'parsing', progress: total ? Math.min(1, res.meta.cursor / total) : 1, rows: rowCount })
    },
  } as Papa.ParseConfig<string[]>)
  void parsed

  const rawHeaders: string[] = headerRaw ?? []
  const norm = normalizeHeaders(
    Array.from({ length: width }, (_, i) => rawHeaders[i] ?? ''),
    false,
  )
  const headers = opts.header ? norm.headers : Array.from({ length: width }, (_, i) => `column_${i + 1}`)
  if (opts.header) {
    for (const r of norm.renamed)
      if (r.index < rawHeaders.length) issues.push({ severity: 'warning', code: 'HeaderRenamed', message: r.from === '' ? `Column ${r.index + 1} has no header — named it “${r.to}”` : `Duplicate header “${r.from}” — column ${r.index + 1} is shown as “${r.to}”`, row: 1 })
  }
  if (ragged) issues.push({ severity: 'warning', code: 'RaggedRows', message: `${ragged.toLocaleString('en-US')} row${ragged > 1 ? 's have' : ' has'} a different number of fields than the header — short rows are padded with empty cells${width > rawHeaders.length && opts.header ? ', extra fields get new columns' : ''}`, row: firstRagged })

  onProgress?.({ phase: 'analyzing', progress: 1, rows: rowCount })
  const columns = builders.map((b) => b.build())
  const numeric: (Float64Array | null)[] = []
  const stats: ColumnStats[] = []
  for (const col of columns) {
    const a = analyze(col, rowCount)
    stats.push(a.stats)
    numeric.push(a.numeric)
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return { headers, columns, numeric, stats, rowCount, delimiter, delimiterDetected, linebreak, issues, raggedRows: ragged, bytes: input.length, parseMs: t1 - t0 }
}

// ── Filtering ────────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')

/** Marks rows (hits[row] = 1) whose cell in `col` contains `q` (case-insensitive). */
export function scanContains(col: PackedColumn, q: string, hits: Uint8Array) {
  if (!q) return
  const re = new RegExp(escapeRe(q), 'giu')
  const { text, offsets } = col
  const n = offsets.length - 1
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const pos = m.index
    // Last row whose start ≤ pos.
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (offsets[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    const end = offsets[lo + 1]
    if (pos + m[0].length <= end) {
      hits[lo] = 1
      re.lastIndex = end
    } else re.lastIndex = pos + 1
    if (re.lastIndex >= text.length) break
  }
}

export type ColumnFilter =
  | { kind: 'contains'; q: string; negate: boolean }
  | { kind: 'equals'; q: string; negate: boolean }
  | { kind: 'empty'; negate: boolean }
  | { kind: 'compare'; op: '>' | '>=' | '<' | '<='; value: number }
  | { kind: 'range'; lo: number; hi: number }

/**
 * Filter mini-language for a column:
 *   text        contains (case-insensitive)      !text   does not contain
 *   =text       equals (case-insensitive)        !=text  not equal
 *   =           is empty                          !=      is not empty
 *   >10 >=10 <10 <=10   numeric/date comparison   10..20  inclusive range
 */
export function parseColumnFilter(expr: string, isDate = false): ColumnFilter | null {
  const e = expr.trim()
  if (!e) return null
  const num = (s: string) => (isDate ? toDate(s) : toNumber(s))
  let m = /^(>=|<=|>|<)\s*(.+)$/.exec(e)
  if (m && !Number.isNaN(num(m[2]))) return { kind: 'compare', op: m[1] as '>' | '>=' | '<' | '<=', value: num(m[2]) }
  m = /^(.+?)\s*\.\.\s*(.+)$/.exec(e)
  if (m && !Number.isNaN(num(m[1])) && !Number.isNaN(num(m[2]))) return { kind: 'range', lo: Math.min(num(m[1]), num(m[2])), hi: Math.max(num(m[1]), num(m[2])) }
  if (e === '=') return { kind: 'empty', negate: false }
  if (e === '!=' || e === '!') return { kind: 'empty', negate: true }
  if (e.startsWith('!=')) return { kind: 'equals', q: e.slice(2), negate: true }
  if (e.startsWith('=')) return { kind: 'equals', q: e.slice(1), negate: false }
  if (e.startsWith('!')) return { kind: 'contains', q: e.slice(1), negate: true }
  return { kind: 'contains', q: e, negate: false }
}

export interface FilterSpec {
  global: string
  /** Column index → filter expression. */
  columns: Record<number, string>
  /** Columns searched by the global filter. */
  visible: number[]
}

/** Returns the rows of `order` (or all rows) that pass every filter, preserving order. */
export function filterRows(ds: Pick<Dataset, 'columns' | 'numeric' | 'rowCount' | 'stats'>, spec: FilterSpec, order?: Int32Array): Int32Array {
  const n = ds.rowCount
  const pass = new Uint8Array(n).fill(1)
  let active = false
  const q = spec.global.trim()
  if (q) {
    active = true
    const hits = new Uint8Array(n)
    for (const c of spec.visible) scanContains(ds.columns[c], q, hits)
    for (let i = 0; i < n; i++) pass[i] &= hits[i]
  }
  for (const [key, expr] of Object.entries(spec.columns)) {
    const c = Number(key)
    const col = ds.columns[c]
    if (!col) continue
    const f = parseColumnFilter(expr, ds.stats[c]?.type === 'date')
    if (!f) continue
    active = true
    applyColumnFilter(col, ds.numeric[c] ?? null, f, pass)
  }
  const base = order ?? identity(n)
  if (!active) return base
  let count = 0
  for (let i = 0; i < base.length; i++) count += pass[base[i]]
  const out = new Int32Array(count)
  let j = 0
  for (let i = 0; i < base.length; i++) if (pass[base[i]]) out[j++] = base[i]
  return out
}

function applyColumnFilter(col: PackedColumn, numeric: Float64Array | null, f: ColumnFilter, pass: Uint8Array) {
  const n = pass.length
  switch (f.kind) {
    case 'contains': {
      const hits = new Uint8Array(n)
      scanContains(col, f.q, hits)
      for (let i = 0; i < n; i++) pass[i] &= f.negate ? hits[i] ^ 1 : hits[i]
      return
    }
    case 'equals': {
      const q = f.q.toLowerCase()
      for (let i = 0; i < n; i++) {
        if (!pass[i]) continue
        const len = col.offsets[i + 1] - col.offsets[i]
        const eq = len === f.q.length || len === q.length ? cellAt(col, i).toLowerCase() === q : false
        if (eq === f.negate) pass[i] = 0
      }
      return
    }
    case 'empty': {
      for (let i = 0; i < n; i++) {
        if (!pass[i]) continue
        const isEmpty = !cellAt(col, i).trim()
        if (isEmpty === f.negate) pass[i] = 0
      }
      return
    }
    case 'compare':
    case 'range': {
      for (let i = 0; i < n; i++) {
        if (!pass[i]) continue
        const v = numeric ? numeric[i] : toNumber(cellAt(col, i))
        let ok: boolean
        if (Number.isNaN(v)) ok = false
        else if (f.kind === 'range') ok = v >= f.lo && v <= f.hi
        else ok = f.op === '>' ? v > f.value : f.op === '>=' ? v >= f.value : f.op === '<' ? v < f.value : v <= f.value
        if (!ok) pass[i] = 0
      }
    }
  }
}

export function identity(n: number): Int32Array {
  const a = new Int32Array(n)
  for (let i = 0; i < n; i++) a[i] = i
  return a
}

// ── Sorting ──────────────────────────────────────────────────────────────────

/**
 * Stable sort order for a column. Numeric/date columns compare by value; text uses a
 * natural, case-insensitive collation ("file2" < "file10"). Empty cells always sort last.
 */
export function sortOrder(col: PackedColumn, numeric: Float64Array | null, dir: 'asc' | 'desc'): Int32Array {
  const n = col.offsets.length - 1
  const idx = Array.from({ length: n }, (_, i) => i)
  const sign = dir === 'asc' ? 1 : -1
  if (numeric) {
    idx.sort((a, b) => {
      const x = numeric[a]
      const y = numeric[b]
      const xn = Number.isNaN(x)
      const yn = Number.isNaN(y)
      if (xn || yn) return xn === yn ? 0 : xn ? 1 : -1
      return x === y ? 0 : x < y ? -sign : sign
    })
  } else {
    const values = new Array<string>(n)
    for (let i = 0; i < n; i++) values[i] = cellAt(col, i)
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    idx.sort((a, b) => {
      const x = values[a]
      const y = values[b]
      if (!x || !y) return !x === !y ? 0 : !x ? 1 : -1
      return sign * collator.compare(x, y)
    })
  }
  return Int32Array.from(idx)
}

// ── Export ───────────────────────────────────────────────────────────────────

export function exportCsv(ds: Pick<Dataset, 'columns' | 'headers'>, rows: Int32Array, cols: number[], opts: { delimiter?: string; lineEnding?: 'lf' | 'crlf' } = {}): string {
  const out: string[][] = new Array(rows.length + 1)
  out[0] = cols.map((c) => ds.headers[c])
  for (let i = 0; i < rows.length; i++) out[i + 1] = cols.map((c) => cellAt(ds.columns[c], rows[i]))
  return serializeCsv(out, { delimiter: opts.delimiter ?? ',', lineEnding: opts.lineEnding })
}

/** Rows as an array of objects; values typed with the CSV → JSON inference rules. */
export function exportJson(ds: Pick<Dataset, 'columns' | 'headers'>, rows: Int32Array, cols: number[], infer: InferOptions | false = DEFAULT_INFER): string {
  const out = new Array(rows.length)
  for (let i = 0; i < rows.length; i++) {
    const o: Record<string, unknown> = {}
    for (const c of cols) {
      const s = cellAt(ds.columns[c], rows[i])
      o[ds.headers[c]] = infer ? inferValue(s, infer) : s
    }
    out[i] = o
  }
  return stringifyJson(out, { indent: 2 })
}

export { looksNumeric }
