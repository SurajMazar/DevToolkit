/**
 * JSON parsing with exact error locations and precision safety.
 *
 * - Numbers that cannot be represented exactly as a JS double (e.g. 64-bit IDs like
 *   12345678901234567890, or 0.1000000000000000055511) are kept as LosslessNumber
 *   objects ({ isLosslessNumber: true, value: '<original digits>' }) so formatting,
 *   diffing and conversion never silently change them.
 * - Errors always carry a 1-based line and column, regardless of browser.
 */
import { LosslessNumber, isLosslessNumber, isSafeNumber, parse as losslessParse } from 'lossless-json'

export { LosslessNumber, isLosslessNumber }

export interface JsonErrorInfo {
  message: string
  line: number
  column: number
  offset: number
}

export type ParseResult = { ok: true; value: unknown; hasBigNumbers: boolean } | { ok: false; error: JsonErrorInfo }

export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let lastNl = -1
  const end = Math.min(offset, text.length)
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lastNl = i
    }
  }
  return { line, column: end - lastNl }
}

// Long digit runs or huge exponents are the only places precision can be lost.
const RE_RISKY_NUMBER = /\d{16,}|[eE][+-]?\d{3,}/

/**
 * True when the text contains a number token (outside strings) that a double can't
 * represent exactly. One regex pass: strings are matched and skipped as whole tokens.
 */
export function hasUnsafeNumbers(text: string): boolean {
  if (!RE_RISKY_NUMBER.test(text)) return false
  const re = /"(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const tok = m[0]
    if (tok.charCodeAt(0) === 34) continue
    if ((tok.length >= 16 || /[eE][+-]?\d{3}/.test(tok)) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(tok) && !isSafeNumber(tok)) return true
  }
  return false
}

let sourceRevivers: boolean | undefined
function supportsReviverSource(): boolean {
  if (sourceRevivers === undefined) {
    try {
      let ok = false
      JSON.parse('1', (_k, v, ctx?: { source?: string }) => {
        ok = ctx?.source === '1'
        return v
      })
      sourceRevivers = ok
    } catch {
      sourceRevivers = false
    }
  }
  return sourceRevivers
}

const numberParser = (s: string) => (isSafeNumber(s) ? parseFloat(s) : new LosslessNumber(s))

/** Strips a UTF-8 BOM, which JSON.parse rejects but editors often add. */
function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function describeError(text: string, err: unknown): JsonErrorInfo {
  const raw = err instanceof Error ? err.message : String(err)
  // lossless-json: "... at position 15"; V8: "... at position 15 (line 2 column 7)"
  const m = raw.match(/position (\d+)/)
  let offset = m ? Number(m[1]) : -1
  if (offset < 0) {
    const lc = raw.match(/line (\d+) column (\d+)/)
    if (lc) {
      const lines = text.split('\n')
      offset = lines.slice(0, Number(lc[1]) - 1).reduce((n, l) => n + l.length + 1, 0) + Number(lc[2]) - 1
    }
  }
  if (offset < 0) offset = text.length
  const { line, column } = offsetToLineColumn(text, offset)
  let message = raw.replace(/\s*\(?at position \d+\)?.*$/s, '').replace(/^JSON\.parse: /, '').replace(/^Unexpected token.*is not valid JSON$/, 'Unexpected token')
  if (offset >= text.length && /end|expected/i.test(raw)) message = message || 'Unexpected end of input'
  const ch = text[offset]
  if (ch !== undefined && !/'/.test(message)) message += ` (found ${JSON.stringify(ch)})`
  return { message: message || 'Invalid JSON', line, column, offset }
}

export function parseJson(input: string): ParseResult {
  const text = stripBom(input)
  if (!text.trim()) return { ok: false, error: { message: 'Input is empty', line: 1, column: 1, offset: 0 } }
  const risky = hasUnsafeNumbers(text)
  try {
    if (!risky) return { ok: true, value: JSON.parse(text), hasBigNumbers: false }
    if (supportsReviverSource()) {
      let big = false
      const value = JSON.parse(text, (_k, v, ctx?: { source?: string }) => {
        if (typeof v === 'number' && ctx?.source && !isSafeNumber(ctx.source)) {
          big = true
          return new LosslessNumber(ctx.source)
        }
        return v
      })
      return { ok: true, value, hasBigNumbers: big }
    }
  } catch {
    // Fall through to the lossless parser, which reports exact positions.
  }
  try {
    let big = false
    const value = losslessParse(text, null, (s: string) => {
      const n = numberParser(s)
      if (typeof n !== 'number') big = true
      return n
    })
    return { ok: true, value, hasBigNumbers: big }
  } catch (e) {
    return { ok: false, error: describeError(text, e) }
  }
}

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export function jsonTypeOf(v: unknown): JsonType {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (isLosslessNumber(v)) return 'number'
  const t = typeof v
  if (t === 'object') return 'object'
  if (t === 'number' || t === 'bigint') return 'number'
  if (t === 'boolean') return 'boolean'
  return 'string'
}

/** Numeric value as a string preserving original digits for LosslessNumbers. */
export function numberText(v: unknown): string {
  return isLosslessNumber(v) ? (v as { value: string }).value : String(v)
}
