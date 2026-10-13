/**
 * JSON string escaping / unescaping and nested ("double-encoded") JSON handling.
 */
import { offsetToLineColumn, parseJson } from '@/engines/json/parse'
import { stringifyJson } from '@/engines/json/stringify'
import { setKey } from './util'

export class EscapeError extends Error {
  offset: number
  line: number
  column: number
  constructor(message: string, text: string, offset: number) {
    const { line, column } = offsetToLineColumn(text, offset)
    super(message)
    this.name = 'EscapeError'
    this.offset = offset
    this.line = line
    this.column = column
  }
}

export interface EscapeOptions {
  /** Wrap in double quotes. Default true. */
  quotes?: boolean
  /** Escape every non-ASCII character as \uXXXX (surrogate pairs for astral characters). */
  asciiOnly?: boolean
  /** Also escape "/" as "\/" (useful inside HTML <script>). */
  escapeSlash?: boolean
}

/** Text → JSON string literal (RFC 8259 escaping; lone surrogates are escaped too). */
export function escapeJsonString(text: string, opts: EscapeOptions = {}): string {
  // JSON.stringify already escapes ", \, control chars and lone surrogates (well-formed stringify).
  let s = JSON.stringify(text)
  if (opts.asciiOnly) s = s.replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
  if (opts.escapeSlash) s = s.replace(/\//g, '\\/')
  return opts.quotes === false ? s.slice(1, -1) : s
}

export interface UnescapeResult {
  text: string
  /** Whether the input was wrapped in quotes. */
  quoted: boolean
  warnings: string[]
}

const SIMPLE: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }

/**
 * JSON string literal → text. Accepts input with or without the surrounding double quotes.
 * Errors report the exact offset (line/column) of the bad escape.
 * Unquoted input is lenient about raw `"` and raw control characters (reported as warnings).
 */
export function unescapeJsonString(input: string): UnescapeResult {
  const warnings: string[] = []
  let start = 0
  let end = input.length
  // Ignore surrounding whitespace (but not inside the literal).
  while (start < end && /\s/.test(input[start])) start++
  while (end > start && /\s/.test(input[end - 1])) end--
  const quoted = end - start >= 2 && input[start] === '"' && input[end - 1] === '"' && !isEscapedAt(input, start + 1, end - 1)
  if (quoted) {
    start++
    end--
  } else {
    start = 0
    end = input.length
    if (input.trimStart().startsWith('"')) {
      throw new EscapeError(end - start >= 2 && input.trimEnd().endsWith('"') ? 'The closing quote is escaped (\\") — the string is not terminated' : 'Missing closing quote', input, input.trimEnd().length)
    }
  }
  let out = ''
  let rawControl = 0
  let rawQuotes = 0
  let loneSurrogates = 0
  let i = start
  while (i < end) {
    const c = input.charCodeAt(i)
    if (c === 0x5c) {
      if (i + 1 >= end) throw new EscapeError('Lone backslash at the end — escape it as \\\\', input, i)
      const e = input[i + 1]
      if (e in SIMPLE) {
        out += SIMPLE[e]
        i += 2
      } else if (e === 'u') {
        const hex = input.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new EscapeError(`Invalid unicode escape "\\u${hex.replace(/[^0-9a-zA-Z].*$/, '')}" — expected 4 hex digits`, input, i)
        const code = parseInt(hex, 16)
        if (i + 6 > end) throw new EscapeError('Truncated unicode escape', input, i)
        out += String.fromCharCode(code)
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = input.slice(i + 6, i + 12)
          if (!/^\\u[dD][c-fC-F][0-9a-fA-F]{2}$/.test(next)) loneSurrogates++
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          const prev = out.charCodeAt(out.length - 2)
          if (!(prev >= 0xd800 && prev <= 0xdbff)) loneSurrogates++
        }
        i += 6
      } else {
        const shown = e === '\n' ? '\\↵' : `\\${e}`
        throw new EscapeError(`Invalid escape "${shown}" — JSON only allows \\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX`, input, i)
      }
    } else if (c === 0x22) {
      if (quoted) throw new EscapeError('Unescaped double quote inside the string — escape it as \\"', input, i)
      rawQuotes++
      out += '"'
      i++
    } else {
      if (c < 0x20) rawControl++
      out += input[i]
      i++
    }
  }
  if (rawControl) warnings.push(`${rawControl} raw control character${rawControl === 1 ? '' : 's'} (e.g. a literal newline or tab) — not valid inside a JSON string literal; kept as-is.`)
  if (rawQuotes) warnings.push(`${rawQuotes} unescaped double quote${rawQuotes === 1 ? '' : 's'} — kept as-is.`)
  if (loneSurrogates) warnings.push(`${loneSurrogates} unpaired surrogate escape${loneSurrogates === 1 ? '' : 's'} (\\uD800–\\uDFFF) — the result is not well-formed Unicode.`)
  return { text: out, quoted, warnings }
}

/** True when the char at `idx` is preceded by an odd number of backslashes (within [from, idx)). */
function isEscapedAt(s: string, from: number, idx: number): boolean {
  let n = 0
  for (let j = idx - 1; j >= from && s[j] === '\\'; j--) n++
  return n % 2 === 1
}

// ── Nested JSON ─────────────────────────────────────────────────────────────

export interface ExpandResult {
  value: unknown
  /** Number of string values that were parsed into JSON. */
  expanded: number
  maxLevel: number
}

function looksLikeJsonContainer(s: string): boolean {
  const t = s.trim()
  if (t.length < 2) return false
  const a = t[0]
  const b = t[t.length - 1]
  return (a === '{' && b === '}') || (a === '[' && b === ']')
}

/**
 * Recursively replaces string values that contain JSON objects/arrays (or a doubly-encoded
 * JSON string) with the parsed value. Primitive-looking strings ("42", "true") are left alone
 * because they are usually meant as strings.
 */
export function expandNestedJson(value: unknown, maxDepth = 32): ExpandResult {
  let expanded = 0
  let maxLevel = 0
  const visit = (v: unknown, level: number): unknown => {
    if (typeof v === 'string') {
      if (level >= maxDepth) return v
      const t = v.trim()
      if (looksLikeJsonContainer(t) || (t.startsWith('"') && t.endsWith('"') && t.length >= 2 && looksLikeJsonContainer(safeParseString(t) ?? ''))) {
        const r = parseJson(t)
        if (r.ok) {
          expanded++
          maxLevel = Math.max(maxLevel, level + 1)
          return visit(r.value, level + 1)
        }
      }
      return v
    }
    if (v === null || typeof v !== 'object' || (v as { isLosslessNumber?: boolean }).isLosslessNumber) return v
    if (Array.isArray(v)) return v.map((x) => visit(x, level))
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v)) setKey(out, k, visit((v as Record<string, unknown>)[k], level))
    return out
  }
  return { value: visit(value, 0), expanded, maxLevel }
}

function safeParseString(t: string): string | null {
  try {
    const s = JSON.parse(t)
    return typeof s === 'string' ? s : null
  } catch {
    return null
  }
}

/**
 * Input text that is either JSON (possibly containing stringified JSON) or a JSON string literal
 * of JSON → fully expanded, pretty-printed JSON.
 */
export function unstringifyNested(input: string, indent = 2): { output: string; expanded: number; levels: number } {
  const r = parseJson(input)
  if (!r.ok) {
    // Maybe a bare escaped body like {\"a\":1} without the outer quotes.
    const t = input.trim()
    if (/^[[{]/.test(t) && t.includes('\\"')) {
      try {
        const body = unescapeJsonString(t)
        const r2 = parseJson(body.text)
        if (r2.ok) {
          const e = expandNestedJson(r2.value)
          return { output: stringifyJson(e.value, { indent }), expanded: e.expanded + 1, levels: e.maxLevel + 1 }
        }
      } catch {
        /* fall through to the original error */
      }
    }
    const err = new EscapeError(r.error.message, input, r.error.offset)
    throw err
  }
  const e = expandNestedJson(r.value)
  if (typeof e.value === 'string') throw new EscapeError('The input is a plain JSON string that does not contain JSON — use Unescape instead', input, 0)
  return { output: stringifyJson(e.value, { indent }), expanded: e.expanded, levels: e.maxLevel }
}

/** JSON text → minified JSON wrapped as an escaped string literal (the reverse of unstringify). */
export function stringifyAsString(input: string, opts: { asciiOnly?: boolean; quotes?: boolean } = {}): string {
  const r = parseJson(input)
  if (!r.ok) throw new EscapeError(r.error.message, input, r.error.offset)
  return escapeJsonString(stringifyJson(r.value), { quotes: opts.quotes ?? true, asciiOnly: opts.asciiOnly })
}
