/**
 * CSV → JSON: parse with papaparse, map headers, infer types, shape the output.
 */
import { stringifyJson } from '@/engines/json/stringify'
import { generatedHeaders, inferValue, kindOf, normalizeHeaders, readCsv, type CsvIssue, type Inferred, type InferOptions, type InferredKind } from './csv'

export type OutputShape = 'objects' | 'arrays' | 'keyed'

export interface CsvToJsonOptions extends InferOptions {
  /** '' = auto-detect. */
  delimiter: string
  quoteChar: string
  header: boolean
  trim: boolean
  skipEmptyLines: boolean
  shape: OutputShape
  /** Column (original header) whose values key the output object in `keyed` shape. */
  keyColumn: string
  /** Build nested objects/arrays from `a.b` and `a[0]` headers. */
  nested: boolean
  /** Spaces, '\t', or 0 for minified. */
  indent: number | '\t'
  /** Original header → new name. */
  rename: Record<string, string>
  /** Original headers to leave out. */
  exclude: string[]
}

export const DEFAULT_CSV_TO_JSON: CsvToJsonOptions = {
  delimiter: '',
  quoteChar: '"',
  header: true,
  trim: false,
  skipEmptyLines: true,
  numbers: true,
  booleans: true,
  emptyAsNull: true,
  shape: 'objects',
  keyColumn: '',
  nested: false,
  indent: 2,
  rename: {},
  exclude: [],
}

export interface CsvColumn {
  /** Header as read from the file (made unique). */
  name: string
  /** Output key after renaming. */
  key: string
  included: boolean
  kind: InferredKind
  empty: number
}

export interface CsvToJsonResult {
  json: string
  columns: CsvColumn[]
  /** Parsed CSV rows (strings, header row included when present) for previews. */
  rows: string[][]
  recordNumbers: Int32Array
  rowCount: number
  delimiter: string
  delimiterDetected: boolean
  linebreak: string
  issues: CsvIssue[]
}

const MAX_LISTED = 5

function listRows(rows: number[]): string {
  const shown = rows.slice(0, MAX_LISTED).join(', ')
  return rows.length > MAX_LISTED ? `${shown} and ${rows.length - MAX_LISTED} more` : shown
}

/** Splits `a.b[0].c` into ['a', 'b', 0, 'c']. Returns null for headers that aren't paths. */
export function parseHeaderPath(h: string): (string | number)[] | null {
  if (!/[.[]/.test(h)) return null
  const out: (string | number)[] = []
  const re = /([^.[\]]+)|\[(\d+)\]|(\.)/g
  let m: RegExpExecArray | null
  let last = 0
  let expectKey = true
  while ((m = re.exec(h))) {
    if (m.index !== last) return null
    last = re.lastIndex
    if (m[1] !== undefined) {
      if (!expectKey) return null
      out.push(m[1])
      expectKey = false
    } else if (m[2] !== undefined) {
      if (!out.length) return null
      out.push(Number(m[2]))
      expectKey = false
    } else {
      if (expectKey) return null
      expectKey = true
    }
  }
  if (last !== h.length || expectKey || out.length < 2) return null
  return out
}

/** Assigns `value` at `path` inside `target`; returns false on a structural conflict. */
function assignPath(target: Record<string, unknown>, path: (string | number)[], value: unknown): boolean {
  let node: Record<string | number, unknown> = target
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]
    const wantArray = typeof path[i + 1] === 'number'
    let child = node[seg]
    if (child === undefined) {
      child = wantArray ? [] : {}
      node[seg] = child
    } else if (child === null || typeof child !== 'object' || Array.isArray(child) !== wantArray) {
      return false
    }
    node = child as Record<string | number, unknown>
  }
  const leaf = path[path.length - 1]
  if (node[leaf] !== undefined && typeof node[leaf] === 'object' && node[leaf] !== null) return false
  node[leaf] = value
  return true
}

/** Fills holes left by sparse `a[3]` headers with null (JSON has no holes). */
function fillHoles(v: unknown): unknown {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = i in v ? fillHoles(v[i]) : null
  } else if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) (v as Record<string, unknown>)[k] = fillHoles((v as Record<string, unknown>)[k])
  }
  return v
}

/**
 * Resolves which output keys become nested paths. A key whose path collides with another
 * (one is a prefix of the other, or a segment is used both as an object key and an array
 * index) stays flat, so no value can overwrite another.
 */
export function nestedPaths(keys: string[]): { paths: ((string | number)[] | null)[]; conflicts: string[] } {
  const parsed = keys.map((k) => parseHeaderPath(k) ?? [k])
  const sig = (p: (string | number)[], n: number) => {
    let s = ''
    for (let i = 0; i < n; i++) s += typeof p[i] === 'number' ? `[${p[i]}]` : `.${String(p[i]).replace(/[.[\]\\]/g, '\\$&')}`
    return s
  }
  const leaves = new Set<string>()
  const nextKinds = new Map<string, Set<string>>()
  for (const p of parsed) {
    leaves.add(sig(p, p.length))
    for (let i = 1; i < p.length; i++) {
      const k = sig(p, i)
      let set = nextKinds.get(k)
      if (!set) nextKinds.set(k, (set = new Set()))
      set.add(typeof p[i])
    }
  }
  const conflicts: string[] = []
  const paths = parsed.map((p, idx) => {
    let bad = nextKinds.has(sig(p, p.length))
    for (let i = 1; i < p.length && !bad; i++) {
      const k = sig(p, i)
      if (leaves.has(k) || (nextKinds.get(k)?.size ?? 0) > 1) bad = true
    }
    if (bad && p.length > 1) conflicts.push(keys[idx])
    return bad || p.length < 2 ? null : p
  })
  return { paths, conflicts }
}

export function csvToJson(text: string, opts: CsvToJsonOptions = DEFAULT_CSV_TO_JSON): CsvToJsonResult {
  const read = readCsv(text, { delimiter: opts.delimiter, quoteChar: opts.quoteChar, skipEmptyLines: opts.skipEmptyLines })
  const issues = [...read.issues]
  const allRows = read.rows
  const headerRow = opts.header && allRows.length ? allRows[0] : null
  const dataStart = headerRow ? 1 : 0
  const dataCount = Math.max(0, allRows.length - dataStart)

  let width = headerRow ? headerRow.length : 0
  for (let i = dataStart; i < allRows.length; i++) if (allRows[i].length > width) width = allRows[i].length

  // Header names: from the file (made unique) or generated; extra columns in long rows get generated names.
  let names: string[]
  if (headerRow) {
    const norm = normalizeHeaders(headerRow, opts.trim)
    names = norm.headers
    for (const r of norm.renamed) {
      issues.push({
        severity: 'warning',
        code: 'HeaderRenamed',
        message: r.from === '' ? `Column ${r.index + 1} has no header — named it “${r.to}”` : `Duplicate header “${r.from}” — the copy in column ${r.index + 1} is named “${r.to}”`,
        row: read.recordNumbers[0],
        line: read.lines[0],
      })
    }
    for (let c = names.length; c < width; c++) {
      let n = `column_${c + 1}`
      while (names.includes(n)) n += '_'
      names.push(n)
    }
  } else {
    names = generatedHeaders(width)
  }

  // Ragged rows: never silently dropped.
  if (headerRow) {
    const short: number[] = []
    const long: number[] = []
    let firstShortLine = 0
    let firstLongLine = 0
    for (let i = dataStart; i < allRows.length; i++) {
      const n = allRows[i].length
      if (n < headerRow.length) {
        if (!short.length) firstShortLine = read.lines[i]
        short.push(read.recordNumbers[i])
      } else if (n > headerRow.length) {
        if (!long.length) firstLongLine = read.lines[i]
        long.push(read.recordNumbers[i])
      }
    }
    if (short.length)
      issues.push({ severity: 'warning', code: 'TooFewFields', message: `${short.length} row${short.length > 1 ? 's have' : ' has'} fewer fields than the header (rows ${listRows(short)}) — missing fields are treated as empty`, row: short[0], line: firstShortLine })
    if (long.length)
      issues.push({ severity: 'warning', code: 'TooManyFields', message: `${long.length} row${long.length > 1 ? 's have' : ' has'} more fields than the header (rows ${listRows(long)}) — extra fields are kept as ${names.slice(headerRow.length).map((n) => `“${n}”`).join(', ')}`, row: long[0], line: firstLongLine })
  }

  const exclude = new Set(opts.exclude)
  const keyOf = (name: string) => (opts.rename[name]?.trim() ? opts.rename[name] : name)
  const infer: InferOptions = { numbers: opts.numbers, booleans: opts.booleans, emptyAsNull: opts.emptyAsNull }

  // Column summaries (kind + empties) over all data rows.
  const columnValues: Inferred[][] = names.map(() => [])
  const empties = new Array<number>(names.length).fill(0)
  const SAMPLE_FOR_KIND = 5000
  const cell = (row: string[], c: number) => {
    const raw = row[c] ?? ''
    return opts.trim ? raw.trim() : raw
  }
  for (let i = dataStart; i < allRows.length; i++) {
    const row = allRows[i]
    for (let c = 0; c < names.length; c++) {
      const s = cell(row, c)
      if (s === '') empties[c]++
      if (i - dataStart < SAMPLE_FOR_KIND) columnValues[c].push(inferValue(s, infer))
    }
  }
  const columns: CsvColumn[] = names.map((name, c) => ({ name, key: keyOf(name), included: !exclude.has(name), kind: kindOf(columnValues[c]), empty: empties[c] }))
  const inc = columns.map((col, c) => ({ col, c })).filter((x) => x.col.included)
  const outKeys = inc.map((x) => x.col.key)
  const dupKeys = outKeys.filter((k, i) => outKeys.indexOf(k) !== i)
  if (dupKeys.length && opts.shape !== 'arrays')
    issues.push({ severity: 'warning', code: 'DuplicateKey', message: `Several columns map to ${[...new Set(dupKeys)].map((k) => `“${k}”`).join(', ')} — the rightmost value wins. Rename one of them.` })

  const paths = opts.nested ? nestedPaths(inc.map((x) => x.col.key)) : { paths: inc.map(() => null), conflicts: [] as string[] }
  if (paths.conflicts.length)
    issues.push({ severity: 'warning', code: 'NestedConflict', message: `${paths.conflicts.map((k) => `“${k}”`).join(', ')} can't be nested because another column is both a value and a parent at that path (e.g. “a” and “a.b”) — kept as flat keys.` })

  const buildObject = (row: string[]) => {
    const obj: Record<string, unknown> = {}
    for (let j = 0; j < inc.length; j++) {
      const v = inferValue(cell(row, inc[j].c), infer)
      const p = paths.paths[j]
      if (!p || !assignPath(obj, p, v)) obj[inc[j].col.key] = v
    }
    return opts.nested ? fillHoles(obj) : obj
  }

  let value: unknown
  if (opts.shape === 'arrays') {
    const out: unknown[][] = []
    if (headerRow) out.push(outKeys)
    for (let i = dataStart; i < allRows.length; i++) out.push(inc.map((x) => inferValue(cell(allRows[i], x.c), infer)))
    value = out
  } else if (opts.shape === 'keyed') {
    const keyCol = names.indexOf(opts.keyColumn)
    if (keyCol === -1) {
      issues.push({ severity: 'error', code: 'KeyColumn', message: opts.keyColumn ? `Key column “${opts.keyColumn}” doesn't exist — pick another one.` : 'Pick the column whose values become the object keys.' })
      value = {}
    } else {
      const out: Record<string, unknown> = {}
      const dupes: number[] = []
      const emptyKeys: number[] = []
      for (let i = dataStart; i < allRows.length; i++) {
        const k = cell(allRows[i], keyCol)
        if (k === '') emptyKeys.push(read.recordNumbers[i])
        if (Object.prototype.hasOwnProperty.call(out, k)) dupes.push(read.recordNumbers[i])
        out[k] = buildObject(allRows[i])
      }
      if (dupes.length) issues.push({ severity: 'warning', code: 'DuplicateKey', message: `${dupes.length} row${dupes.length > 1 ? 's repeat' : ' repeats'} a key already used (rows ${listRows(dupes)}) — later rows replace earlier ones.`, row: dupes[0] })
      if (emptyKeys.length) issues.push({ severity: 'warning', code: 'EmptyKey', message: `${emptyKeys.length} row${emptyKeys.length > 1 ? 's have' : ' has'} an empty key (rows ${listRows(emptyKeys)}) — stored under "".`, row: emptyKeys[0] })
      value = out
    }
  } else {
    const out: unknown[] = new Array(dataCount)
    for (let i = dataStart; i < allRows.length; i++) out[i - dataStart] = buildObject(allRows[i])
    value = out
  }

  return {
    json: stringifyJson(value, { indent: opts.indent === 0 ? '' : opts.indent }),
    columns,
    rows: allRows,
    recordNumbers: read.recordNumbers,
    rowCount: dataCount,
    delimiter: read.delimiter,
    delimiterDetected: read.delimiterDetected,
    linebreak: read.linebreak,
    issues,
  }
}
