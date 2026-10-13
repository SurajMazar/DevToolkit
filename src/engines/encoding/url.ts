/**
 * Percent-encoding (RFC 3986 / WHATWG URL) with exact, position-aware error reporting.
 *
 * Encoding is implemented directly (not via encodeURIComponent) so lone surrogates are
 * reported with their position instead of a bare "URIError: URI malformed".
 */
import { decodeUtf8At, describeUtf8Problem, lineColumnAt } from './utf8'

export type UrlEncodeMode = 'component' | 'uri' | 'form' | 'all'

export interface UrlEncodeOptions {
  mode: UrlEncodeMode
  /** Encode each line separately, keeping line breaks literal. */
  perLine?: boolean
  /** Use lowercase hex digits (%e2) instead of the conventional uppercase (%E2). */
  lowercase?: boolean
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Characters each mode leaves untouched (besides those listed, everything is encoded). */
export const UNRESERVED: Record<UrlEncodeMode, string> = {
  /** encodeURIComponent */
  component: ALNUM + "-_.!~*'()",
  /** encodeURI — keeps URL syntax characters */
  uri: ALNUM + "-_.!~*'()" + ';,/?:@&=+$#',
  /** application/x-www-form-urlencoded (WHATWG URLSearchParams) — space becomes + */
  form: ALNUM + '*-._',
  all: '',
}

const keepTables = Object.fromEntries(
  (Object.keys(UNRESERVED) as UrlEncodeMode[]).map((m) => {
    const t = new Uint8Array(128)
    for (const ch of UNRESERVED[m]) t[ch.charCodeAt(0)] = 1
    return [m, t]
  }),
) as Record<UrlEncodeMode, Uint8Array>

export class UrlCodecError extends Error {
  offset: number
  line: number
  column: number
  constructor(message: string, text: string, offset: number) {
    const { line, column } = lineColumnAt(text, offset)
    super(message)
    this.name = 'UrlCodecError'
    this.offset = offset
    this.line = line
    this.column = column
  }
}

function hex2(b: number, lower: boolean) {
  const h = b.toString(16).padStart(2, '0')
  return lower ? h : h.toUpperCase()
}

function encodeSegment(text: string, base: number, full: string, opts: UrlEncodeOptions): string {
  const keep = keepTables[opts.mode]
  const lower = !!opts.lowercase
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) {
      if (keep[c]) out += text[i]
      else if (c === 0x20 && opts.mode === 'form') out += '+'
      else out += '%' + hex2(c, lower)
      continue
    }
    let cp = c
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        cp = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00)
        i++
      } else throw new UrlCodecError(`Unpaired surrogate U+${c.toString(16).toUpperCase()} cannot be encoded as UTF-8`, full, base + i)
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throw new UrlCodecError(`Unpaired surrogate U+${c.toString(16).toUpperCase()} cannot be encoded as UTF-8`, full, base + i)
    }
    if (cp < 0x800) out += '%' + hex2(0xc0 | (cp >> 6), lower) + '%' + hex2(0x80 | (cp & 0x3f), lower)
    else if (cp < 0x10000)
      out += '%' + hex2(0xe0 | (cp >> 12), lower) + '%' + hex2(0x80 | ((cp >> 6) & 0x3f), lower) + '%' + hex2(0x80 | (cp & 0x3f), lower)
    else
      out +=
        '%' + hex2(0xf0 | (cp >> 18), lower) + '%' + hex2(0x80 | ((cp >> 12) & 0x3f), lower) + '%' + hex2(0x80 | ((cp >> 6) & 0x3f), lower) + '%' + hex2(0x80 | (cp & 0x3f), lower)
  }
  return out
}

/** Splits text into [content, lineBreak, content, lineBreak, …, content]. */
function splitLines(text: string): string[] {
  return text.split(/(\r\n|\n|\r)/)
}

export function encodeUrl(text: string, opts: UrlEncodeOptions): string {
  if (!opts.perLine) return encodeSegment(text, 0, text, opts)
  const parts = splitLines(text)
  let offset = 0
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    out += i % 2 === 0 ? encodeSegment(parts[i], offset, text, opts) : parts[i]
    offset += parts[i].length
  }
  return out
}

export interface PercentIssue {
  /** Offset in the input text (UTF-16 units). */
  offset: number
  /** Length of the offending source text. */
  length: number
  line: number
  column: number
  /** The offending source text, e.g. "%E0%A4" or "%ZZ". */
  source: string
  message: string
}

export interface UrlDecodeOptions {
  /** Treat "+" as a space (form encoding / query strings). */
  plusAsSpace?: boolean
  /** Leave malformed sequences unchanged instead of failing. */
  lenient?: boolean
  /** Decode each line independently: lines with errors are kept unchanged and reported. */
  perLine?: boolean
}

export interface UrlDecodeResult {
  text: string
  issues: PercentIssue[]
  /** Number of valid escapes decoded. */
  escapes: number
  /** Lines left unchanged because of errors (perLine strict mode). */
  skippedLines: number
  /** The decoded text still contains %XX — the input may be double-encoded. */
  stillEncoded: boolean
  /** Strict mode found errors: `text` is empty. */
  failed: boolean
}

const pct = (b: ArrayLike<number>) => Array.from(b, (x) => '%' + hex2(x, false)).join('')
const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
const hexVal = (c: number) => (c <= 57 ? c - 48 : (c | 0x20) - 87)

/** Decodes one segment; returns the text where malformed parts are kept as-is, plus issues. */
function decodeSegment(text: string, base: number, full: string, plusAsSpace: boolean, issues: PercentIssue[]): { out: string; escapes: number } {
  let out = ''
  let escapes = 0
  const n = text.length
  let i = 0
  const td = new TextDecoder()
  const issue = (offset: number, length: number, message: string) => {
    const abs = base + offset
    const { line, column } = lineColumnAt(full, abs)
    issues.push({ offset: abs, length, line, column, source: text.slice(offset, offset + length), message })
  }
  while (i < n) {
    const c = text.charCodeAt(i)
    if (c === 0x2b && plusAsSpace) {
      out += ' '
      i++
      continue
    }
    if (c !== 0x25) {
      // Copy a run of plain characters at once.
      let j = i + 1
      while (j < n) {
        const d = text.charCodeAt(j)
        if (d === 0x25 || (d === 0x2b && plusAsSpace)) break
        j++
      }
      out += text.slice(i, j)
      i = j
      continue
    }
    // Collect a run of well-formed %XX escapes.
    const bytes: number[] = []
    const at: number[] = []
    while (i < n && text.charCodeAt(i) === 0x25 && isHex(text.charCodeAt(i + 1)) && isHex(text.charCodeAt(i + 2))) {
      bytes.push((hexVal(text.charCodeAt(i + 1)) << 4) | hexVal(text.charCodeAt(i + 2)))
      at.push(i)
      i += 3
    }
    if (bytes.length === 0) {
      // A "%" that isn't followed by two hex digits.
      let len = 1
      while (len < 3 && i + len < n && /[^\s%&=?#/;+,]/.test(text[i + len])) len++
      const shown = text.slice(i, i + len)
      issue(i, len, i + 1 >= n ? '"%" at the end of the input is not followed by two hex digits' : `"${shown}" is not a valid escape — "%" must be followed by two hex digits (write %25 for a literal "%")`)
      out += '%'
      i++
      continue
    }
    const arr = Uint8Array.from(bytes)
    let k = 0
    let runStart = 0
    while (k < arr.length) {
      if (arr[k] < 0x80) {
        k++
        continue
      }
      const seq = decodeUtf8At(arr, k)
      if (seq.cp === -1) {
        if (runStart < k) out += td.decode(arr.subarray(runStart, k))
        const srcStart = at[k]
        const srcEnd = at[k + seq.length - 1] + 3
        const src = text.slice(srcStart, srcEnd)
        issue(srcStart, srcEnd - srcStart, `Invalid UTF-8: ${describeUtf8Problem(seq, arr, pct).replace("the data ends", "no further escape follows")}`)
        out += src
        runStart = k + seq.length
      }
      k += seq.length
    }
    if (runStart < arr.length) out += td.decode(arr.subarray(runStart))
    escapes += arr.length
  }
  return { out, escapes }
}

export function decodeUrl(text: string, opts: UrlDecodeOptions = {}): UrlDecodeResult {
  const issues: PercentIssue[] = []
  let escapes = 0
  let skippedLines = 0
  let out = ''
  if (opts.perLine) {
    const parts = splitLines(text)
    let offset = 0
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) out += parts[i]
      else {
        const before = issues.length
        const r = decodeSegment(parts[i], offset, text, !!opts.plusAsSpace, issues)
        if (issues.length > before && !opts.lenient) {
          out += parts[i]
          skippedLines++
        } else {
          out += r.out
          escapes += r.escapes
        }
      }
      offset += parts[i].length
    }
  } else {
    const r = decodeSegment(text, 0, text, !!opts.plusAsSpace, issues)
    out = r.out
    escapes = r.escapes
  }
  const failed = !opts.lenient && !opts.perLine && issues.length > 0
  return {
    text: failed ? '' : out,
    issues,
    escapes,
    skippedLines,
    stillEncoded: !failed && /%[0-9A-Fa-f]{2}/.test(out) && escapes > 0,
    failed,
  }
}
