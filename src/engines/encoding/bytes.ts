/**
 * Text ⇄ byte notations (binary, octal, decimal, hex) with an auto-detecting, validating parser.
 */
import { decodeUtf8Lenient, lineColumnAt } from './utf8'

export type ByteBase = 'bin' | 'oct' | 'dec' | 'hex'
export type ByteSeparator = 'space' | 'none' | 'comma' | 'newline'
export type BytePrefix = 'none' | 'c' | 'escape'

export const BASE_INFO: Record<ByteBase, { radix: number; width: number; name: string; cPrefix: string; escape: string | null }> = {
  bin: { radix: 2, width: 8, name: 'Binary', cPrefix: '0b', escape: null },
  oct: { radix: 8, width: 3, name: 'Octal', cPrefix: '0o', escape: '\\' },
  dec: { radix: 10, width: 0, name: 'Decimal', cPrefix: '', escape: null },
  hex: { radix: 16, width: 2, name: 'Hex', cPrefix: '0x', escape: '\\x' },
}

export interface ByteFormatOptions {
  base: ByteBase
  separator: ByteSeparator
  /** "c" = 0x / 0b / 0o; "escape" = \x (hex) or \ (octal). */
  prefix?: BytePrefix
  uppercase?: boolean
  /** Insert a line break after this many bytes (0 = never). */
  bytesPerLine?: number
}

export function prefixFor(base: ByteBase, prefix: BytePrefix = 'none'): string {
  if (prefix === 'c') return BASE_INFO[base].cPrefix
  if (prefix === 'escape') return BASE_INFO[base].escape ?? ''
  return ''
}

export function formatByteNotation(bytes: Uint8Array, opts: ByteFormatOptions): string {
  const info = BASE_INFO[opts.base]
  const pre = prefixFor(opts.base, opts.prefix)
  const sep = opts.prefix === 'escape' && opts.separator === 'none' ? '' : { space: ' ', none: '', comma: ', ', newline: '\n' }[opts.separator]
  const perLine = opts.bytesPerLine && opts.bytesPerLine > 0 && opts.separator !== 'newline' ? opts.bytesPerLine : 0
  // Pre-render the 256 possible tokens once.
  const table: string[] = new Array(256)
  for (let b = 0; b < 256; b++) {
    let s = b.toString(info.radix)
    if (info.width) s = s.padStart(info.width, '0')
    if (opts.uppercase) s = s.toUpperCase()
    table[b] = pre + s
  }
  const parts: string[] = []
  const lineSep = opts.separator === 'comma' ? ',\n' : '\n'
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0) parts.push(perLine && i % perLine === 0 ? lineSep : sep)
    parts.push(table[bytes[i]])
  }
  return parts.join('')
}

export function textToByteNotation(text: string, opts: ByteFormatOptions): string {
  return formatByteNotation(new TextEncoder().encode(text), opts)
}

export interface ByteParseIssue {
  offset: number
  length: number
  line: number
  column: number
  message: string
}

export interface ByteParseResult {
  bytes: Uint8Array
  base: ByteBase
  /** How the base was chosen. */
  detected: 'prefix' | 'heuristic' | 'forced'
  /** The input could also be read as another base. */
  ambiguousWith?: ByteBase
  issues: ByteParseIssue[]
  /** Source offset of each byte (for mapping UTF-8 problems back to the input). */
  offsets: Uint32Array
}

interface Token {
  text: string
  offset: number
  prefix: '' | '0x' | '\\x' | '0b' | '0o' | '\\' | '%' | '&#x' | 'u'
}

const SEPARATOR = /[\s,;[\]{}()]+/g

/** Splits on separators and on embedded prefixes ("\x48\x65", "%48%65", "0x480x65"). */
function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  const push = (chunk: string, offset: number) => {
    if (!chunk) return
    // C-style prefixes (0x / 0b / 0o) only at the start of a value — "0x0b" is one hex byte.
    // Escape prefixes (\x, \ and %) may be chained without separators: "\x48\x65", "%48%65".
    const pieces: { at: number; prefix: Token['prefix'] }[] = []
    const c = /^0[xXbBoO]/.exec(chunk)
    if (c) pieces.push({ at: 0, prefix: c[0].toLowerCase() as Token['prefix'] })
    const re = /\\x|\\|%/g
    re.lastIndex = c ? 2 : 0
    let m: RegExpExecArray | null
    while ((m = re.exec(chunk))) pieces.push({ at: m.index, prefix: m[0] as Token['prefix'] })
    if (!pieces.length || pieces[0].at !== 0) tokens.push({ text: chunk.slice(0, pieces.length ? pieces[0].at : chunk.length), offset, prefix: '' })
    for (let i = 0; i < pieces.length; i++) {
      const start = pieces[i].at
      const end = i + 1 < pieces.length ? pieces[i + 1].at : chunk.length
      tokens.push({ text: chunk.slice(start + pieces[i].prefix.length, end), offset: offset + start, prefix: pieces[i].prefix })
    }
  }
  SEPARATOR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SEPARATOR.exec(input))) {
    push(input.slice(last, m.index), last)
    last = m.index + m[0].length
  }
  push(input.slice(last), last)
  return tokens
}

const PREFIX_BASE: Partial<Record<Token['prefix'], ByteBase>> = { '0x': 'hex', '\\x': 'hex', '%': 'hex', '0b': 'bin', '0o': 'oct', '\\': 'oct' }

export function detectByteBase(input: string): { base: ByteBase; detected: 'prefix' | 'heuristic'; ambiguousWith?: ByteBase } {
  const tokens = tokenize(input)
  for (const t of tokens) {
    const b = PREFIX_BASE[t.prefix]
    if (b) return { base: b, detected: 'prefix' }
  }
  const texts = tokens.map((t) => t.text).filter(Boolean)
  if (!texts.length) return { base: 'hex', detected: 'heuristic' }
  if (texts.some((t) => /[a-fA-F]/.test(t))) return { base: 'hex', detected: 'heuristic' }
  // Binary: only 0/1, in 8-bit groups — or unpadded 7-bit groups like "1001000 1100101".
  if (texts.every((t) => /^[01]+$/.test(t)) && texts.every((t) => t.length % 8 === 0 || (texts.length > 1 && t.length >= 5 && t.length <= 8))) return { base: 'bin', detected: 'heuristic' }
  if (texts.length === 1) {
    // One contiguous run of digits.
    return { base: 'hex', detected: 'heuristic', ambiguousWith: texts[0].length <= 3 ? 'dec' : undefined }
  }
  if (texts.every((t) => t.length === 2)) return { base: 'hex', detected: 'heuristic', ambiguousWith: 'dec' }
  const octalShaped = texts.every((t) => /^[0-3][0-7]{2}$/.test(t))
  if (octalShaped && texts.some((t) => t[0] === '0')) return { base: 'oct', detected: 'heuristic', ambiguousWith: 'dec' }
  return { base: 'dec', detected: 'heuristic', ambiguousWith: octalShaped ? 'oct' : undefined }
}

const DIGITS: Record<ByteBase, RegExp> = { bin: /[^01]/, oct: /[^0-7]/, dec: /[^0-9]/, hex: /[^0-9a-fA-F]/ }

export function parseByteNotation(input: string, base: ByteBase | 'auto' = 'auto', maxIssues = 200): ByteParseResult {
  const det = base === 'auto' ? detectByteBase(input) : { base, detected: 'forced' as const }
  const b = det.base
  const info = BASE_INFO[b]
  const issues: ByteParseIssue[] = []
  const issue = (offset: number, length: number, message: string) => {
    if (issues.length >= maxIssues) return
    const { line, column } = lineColumnAt(input, offset)
    issues.push({ offset, length, line, column, message })
  }
  const out: number[] = []
  const offsets: number[] = []
  const tokens = tokenize(input)
  const separated = tokens.length > 1
  for (const t of tokens) {
    if (!t.text) {
      if (t.prefix) issue(t.offset, t.prefix.length, `"${t.prefix}" is not followed by any digits`)
      continue
    }
    const pb = PREFIX_BASE[t.prefix]
    if (pb && pb !== b) {
      issue(t.offset, t.prefix.length + t.text.length, `"${t.prefix}${t.text}" uses a ${BASE_INFO[pb].name.toLowerCase()} prefix but the input is read as ${info.name.toLowerCase()}`)
      continue
    }
    const digitsAt = t.offset + t.prefix.length
    const bad = t.text.search(DIGITS[b])
    if (bad !== -1) {
      issue(digitsAt + bad, 1, `"${t.text[bad]}" is not a ${info.name.toLowerCase()} digit${b === 'bin' ? ' (only 0 and 1)' : b === 'oct' ? ' (0–7)' : b === 'hex' ? ' (0–9, A–F)' : ''}`)
      continue
    }
    if (b === 'dec') {
      const v = Number(t.text)
      if (v > 255) {
        issue(digitsAt, t.text.length, `${t.text} is larger than 255, so it doesn't fit in a byte`)
        continue
      }
      out.push(v)
      offsets.push(t.offset)
      continue
    }
    const w = info.width
    // Octal escapes ("\101") and single values may be shorter than the full width.
    if (t.text.length <= w && (t.prefix || t.text.length === w || separated)) {
      const v = parseInt(t.text, info.radix)
      if (v > 255) {
        issue(digitsAt, t.text.length, `${t.prefix}${t.text} is larger than 255 (0o377), so it doesn't fit in a byte`)
        continue
      }
      out.push(v)
      offsets.push(t.offset)
      continue
    }
    // A contiguous run: split into fixed-width bytes.
    if (t.text.length % w !== 0) {
      const whole = t.text.length - (t.text.length % w)
      issue(digitsAt + whole, t.text.length - whole, `Incomplete byte: ${t.text.length} ${info.name.toLowerCase()} digits is not a multiple of ${w} — "${t.text.slice(whole)}" is left over`)
    }
    for (let i = 0; i + w <= t.text.length; i += w) {
      const v = parseInt(t.text.slice(i, i + w), info.radix)
      if (v > 255) {
        issue(digitsAt + i, w, `${t.text.slice(i, i + w)} is larger than 255 (0o377)`)
        continue
      }
      out.push(v)
      offsets.push(digitsAt + i)
    }
  }
  return { bytes: Uint8Array.from(out), base: b, detected: det.detected, ambiguousWith: 'ambiguousWith' in det ? det.ambiguousWith : undefined, issues, offsets: Uint32Array.from(offsets) }
}

export interface BytesToTextResult {
  text: string
  /** Invalid UTF-8 sequences with byte index and source offset. */
  invalid: { byteOffset: number; length: number; sourceOffset: number; message: string }[]
  invalidCount: number
}

export function bytesToUtf8Text(parsed: ByteParseResult): BytesToTextResult {
  const d = decodeUtf8Lenient(parsed.bytes, 200)
  return {
    text: d.text,
    invalid: d.issues.map((i) => ({ byteOffset: i.offset, length: i.length, sourceOffset: parsed.offsets[i.offset] ?? 0, message: i.message })),
    invalidCount: d.issueCount,
  }
}
