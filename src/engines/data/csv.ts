/**
 * CSV core: an RFC 4180 serializer, a papaparse-backed reader with exact row/line
 * reporting, delimiter detection and the value-inference rules shared by the CSV tools.
 *
 * Pure TypeScript — safe to run in a worker or in Node tests.
 */
import Papa from 'papaparse'
import { isSafeNumber } from 'lossless-json'
import { offsetToLineColumn } from '@/engines/json/parse'

// ── Writing ──────────────────────────────────────────────────────────────────

export type QuoteStyle = 'minimal' | 'all'
export type LineEnding = 'lf' | 'crlf'

export interface CsvWriteOptions {
  /** Field delimiter; may be more than one character. Default `,`. */
  delimiter?: string
  /** `minimal` quotes only fields that need it (RFC 4180); `all` quotes every field. */
  quote?: QuoteStyle
  quoteChar?: string
  lineEnding?: LineEnding
  /** Prefix a UTF-8 byte-order mark so Excel detects the encoding. */
  bom?: boolean
  /** End the last record with a line break too (default true). */
  trailingNewline?: boolean
}

export const BOM = '﻿'

/**
 * Quotes a single field when required. A field needs quoting when it contains the
 * delimiter, the quote character, CR or LF, or has leading/trailing whitespace (which
 * many readers would otherwise trim). Embedded quotes are doubled.
 */
export function escapeCsvField(value: string, delimiter = ',', quoteChar = '"', quoteAll = false): string {
  const needs =
    quoteAll ||
    value.includes(delimiter) ||
    value.includes(quoteChar) ||
    value.includes('\n') ||
    value.includes('\r') ||
    (value.length > 0 && (isEdgeSpace(value.charCodeAt(0)) || isEdgeSpace(value.charCodeAt(value.length - 1))))
  if (!needs) return value
  return quoteChar + value.split(quoteChar).join(quoteChar + quoteChar) + quoteChar
}

function isEdgeSpace(c: number) {
  return c === 32 || c === 9
}

/** Serializes rows of string cells. `null`/`undefined` cells are written as empty fields. */
export function serializeCsv(rows: readonly (readonly (string | null | undefined)[])[], opts: CsvWriteOptions = {}): string {
  const delimiter = opts.delimiter || ','
  const quoteChar = opts.quoteChar || '"'
  const all = opts.quote === 'all'
  const eol = opts.lineEnding === 'crlf' ? '\r\n' : '\n'
  const parts: string[] = []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    let line = ''
    for (let c = 0; c < row.length; c++) {
      if (c) line += delimiter
      line += escapeCsvField(row[c] ?? '', delimiter, quoteChar, all)
    }
    parts.push(line)
  }
  let out = parts.join(eol)
  if (rows.length && opts.trailingNewline !== false) out += eol
  return (opts.bom ? BOM : '') + out
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface CsvIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  /** 1-based record number in the file (the header row is record 1). */
  row?: number
  /** 1-based line/column where known. */
  line?: number
  column?: number
}

export interface CsvReadOptions {
  /** '' = auto-detect. */
  delimiter?: string
  quoteChar?: string
  /** Drop records that are completely empty (blank lines). */
  skipEmptyLines?: boolean
}

export interface CsvReadResult {
  rows: string[][]
  /** For each kept row, its 1-based record number in the original file. */
  recordNumbers: Int32Array
  /** For each kept row, the 1-based line on which it starts. */
  lines: Int32Array
  delimiter: string
  delimiterDetected: boolean
  linebreak: string
  issues: CsvIssue[]
  hadBom: boolean
}

export const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const

export function delimiterLabel(d: string): string {
  switch (d) {
    case ',':
      return 'Comma'
    case ';':
      return 'Semicolon'
    case '\t':
      return 'Tab'
    case '|':
      return 'Pipe'
    case ' ':
      return 'Space'
    default:
      return JSON.stringify(d)
  }
}

/**
 * Picks the delimiter that splits the first lines into the most consistent number
 * of fields (> 1). Quotes are respected by parsing a sample with each candidate.
 */
export function detectDelimiter(text: string, quoteChar = '"'): { delimiter: string; confident: boolean } {
  const sample = sampleLines(text, 40)
  let best = { delimiter: ',', score: -1 }
  for (const d of DELIMITER_CANDIDATES) {
    const r = Papa.parse<string[]>(sample, { delimiter: d, quoteChar, skipEmptyLines: true, preview: 40 })
    const counts = r.data.map((row) => row.length)
    if (!counts.length) continue
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length
    if (avg <= 1) continue
    const mode = modeOf(counts)
    const consistency = counts.filter((c) => c === mode).length / counts.length
    const score = consistency * 100 + Math.min(mode, 50)
    if (score > best.score) best = { delimiter: d, score }
  }
  return { delimiter: best.delimiter, confident: best.score >= 0 }
}

function sampleLines(text: string, lines: number): string {
  let idx = 0
  for (let i = 0; i < lines; i++) {
    const n = text.indexOf('\n', idx)
    if (n === -1) return text.slice(0, 200_000)
    idx = n + 1
    if (idx > 200_000) break
  }
  return text.slice(0, idx)
}

function modeOf(values: number[]): number {
  const m = new Map<number, number>()
  let best = values[0]
  let bestN = 0
  for (const v of values) {
    const n = (m.get(v) ?? 0) + 1
    m.set(v, n)
    if (n > bestN) {
      best = v
      bestN = n
    }
  }
  return best
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Detects the dominant line break of a text (defaults to \n). */
export function detectLinebreak(text: string): string {
  const sample = text.slice(0, 100_000)
  const crlf = sample.split('\r\n').length - 1
  const lf = sample.split('\n').length - 1 - crlf
  const cr = sample.split('\r').length - 1 - crlf
  if (crlf && crlf >= lf && crlf >= cr) return '\r\n'
  if (cr > lf) return '\r'
  return '\n'
}

export function linebreakLabel(lb: string) {
  return lb === '\r\n' ? 'CRLF' : lb === '\r' ? 'CR' : 'LF'
}

const isBlankRecord = (row: string[]) => row.length === 1 && row[0] === ''

/**
 * Parses CSV text into rows of strings. Never throws for malformed CSV: quote problems
 * are reported as issues with record and line numbers, and the parser recovers like
 * spreadsheet software does.
 */
export function readCsv(input: string, opts: CsvReadOptions = {}): CsvReadResult {
  const hadBom = input.charCodeAt(0) === 0xfeff
  const text = stripBom(input)
  const quoteChar = opts.quoteChar || '"'
  let delimiter = opts.delimiter ?? ''
  let delimiterDetected = false
  if (!delimiter) {
    delimiter = detectDelimiter(text, quoteChar).delimiter
    delimiterDetected = true
  }
  const linebreak = detectLinebreak(text)
  const parsed = Papa.parse<string[]>(text, { delimiter, quoteChar, newline: linebreak as '\n', skipEmptyLines: false })
  const all = parsed.data
  // A final line break terminates the last record; it does not start a new one.
  if (all.length && isBlankRecord(all[all.length - 1]) && /[\r\n]$/.test(text)) all.pop()

  const issues: CsvIssue[] = []
  const seen = new Set<string>()
  for (const e of parsed.errors) {
    if (e.code === 'UndetectableDelimiter') continue
    const key = `${e.code}:${e.row}`
    if (seen.has(key)) continue
    seen.add(key)
    const pos = typeof e.index === 'number' ? offsetToLineColumn(text, e.index) : undefined
    issues.push({
      severity: 'error',
      code: e.code,
      message: quoteMessage(e.code, e.message, quoteChar),
      row: typeof e.row === 'number' ? e.row + 1 : undefined,
      line: pos?.line,
      column: pos?.column,
    })
  }

  const allLines = computeRecordLines(text, all, linebreak)
  let rows = all
  let recordNumbers: Int32Array
  let lines: Int32Array
  if (opts.skipEmptyLines) {
    rows = []
    const nums: number[] = []
    const ls: number[] = []
    for (let i = 0; i < all.length; i++) {
      if (isBlankRecord(all[i])) continue
      rows.push(all[i])
      nums.push(i + 1)
      ls.push(allLines[i])
    }
    recordNumbers = Int32Array.from(nums)
    lines = Int32Array.from(ls)
  } else {
    recordNumbers = new Int32Array(all.length)
    for (let i = 0; i < all.length; i++) recordNumbers[i] = i + 1
    lines = allLines
  }
  return { rows, recordNumbers, lines, delimiter, delimiterDetected, linebreak, issues, hadBom }
}

/**
 * 1-based starting line of every record. Records only span several lines when a quoted
 * field contains line breaks; when the line count equals the record count we skip the scan.
 */
function computeRecordLines(text: string, rows: string[][], linebreak: string): Int32Array {
  const out = new Int32Array(rows.length)
  const brk = linebreak === '\r' ? '\r' : '\n'
  let total = 1
  for (let i = text.indexOf(brk); i !== -1; i = text.indexOf(brk, i + 1)) total++
  if (/[\r\n]$/.test(text)) total--
  if (total === rows.length) {
    for (let i = 0; i < rows.length; i++) out[i] = i + 1
    return out
  }
  let line = 1
  for (let i = 0; i < rows.length; i++) {
    out[i] = line
    let extra = 0
    for (const cell of rows[i]) {
      for (let k = cell.indexOf(brk); k !== -1; k = cell.indexOf(brk, k + 1)) extra++
    }
    line += 1 + extra
  }
  return out
}

function quoteMessage(code: string, message: string, q: string) {
  if (code === 'MissingQuotes') return `Quoted field is never closed — a ${q} is missing, so the rest of the file was read into one field`
  if (code === 'InvalidQuotes') return `Malformed quoted field — text follows the closing ${q} (use ${q}${q} for a literal quote)`
  return message
}

// ── Header handling ──────────────────────────────────────────────────────────

/** Makes header names unique and non-empty: duplicates get `_2`, `_3`…; blanks become `column_N`. */
export function normalizeHeaders(raw: string[], trim: boolean): { headers: string[]; renamed: { index: number; from: string; to: string }[] } {
  const used = new Set<string>()
  const renamed: { index: number; from: string; to: string }[] = []
  const headers = raw.map((h, i) => {
    const base = trim ? h.trim() : h
    let name = base === '' ? `column_${i + 1}` : base
    if (used.has(name)) {
      let n = 2
      while (used.has(`${name}_${n}`)) n++
      name = `${name}_${n}`
    }
    if (name !== base) renamed.push({ index: i, from: base, to: name })
    used.add(name)
    return name
  })
  return { headers, renamed }
}

export function generatedHeaders(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `column_${i + 1}`)
}

// ── Value inference ──────────────────────────────────────────────────────────

export interface InferOptions {
  numbers: boolean
  booleans: boolean
  /** Empty fields become null instead of "". */
  emptyAsNull: boolean
}

export const DEFAULT_INFER: InferOptions = { numbers: true, booleans: true, emptyAsNull: true }

const RE_JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
/** Integer part longer than this is treated as an identifier, not a quantity. */
export const MAX_NUMERIC_DIGITS = 15

/**
 * Rules for turning a CSV field into a number — deliberately conservative:
 * - Must be a plain JSON number (`-12`, `3.5`, `1e6`). No `+`, `.5`, `1,000`, `0x1F`, spaces.
 * - Leading zeros keep it a string (`02134` ZIP codes, `007`).
 * - An integer part with more than 15 digits stays a string (IDs, card numbers).
 * - Values JavaScript can't represent exactly (`0.1000000000000000055511`) stay strings.
 * - `-0` stays a string (JSON would print it as `0`).
 */
export function looksNumeric(s: string): boolean {
  if (!RE_JSON_NUMBER.test(s)) return false
  if (s === '-0') return false
  const intDigits = s.replace(/^-/, '').split(/[.eE]/)[0].length
  if (intDigits > MAX_NUMERIC_DIGITS) return false
  return isSafeNumber(s)
}

export type Inferred = string | number | boolean | null

export function inferValue(s: string, o: InferOptions): Inferred {
  if (s === '') return o.emptyAsNull ? null : ''
  if (o.numbers && looksNumeric(s)) return Number(s)
  if (o.booleans) {
    const l = s.length
    if (l === 4 || l === 5) {
      const v = s.toLowerCase()
      if (v === 'true') return true
      if (v === 'false') return false
    }
  }
  return s
}

export type InferredKind = 'number' | 'boolean' | 'string' | 'null' | 'mixed' | 'empty'

/** Summarizes the inferred kind of a column's values. */
export function kindOf(values: Inferred[]): InferredKind {
  let kind: InferredKind = 'empty'
  for (const v of values) {
    const k: InferredKind = v === null ? 'null' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : v === '' ? 'empty' : 'string'
    if (k === 'null' || k === 'empty') continue
    if (kind === 'empty') kind = k
    else if (kind !== k) return 'mixed'
  }
  return kind
}
