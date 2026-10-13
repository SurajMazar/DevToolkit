/**
 * Whitespace & invisible-character analysis: classification, per-line tokenization for
 * rendering, summary counts with first occurrences, line-ending detection and cleanups.
 * Works on raw strings (CR, CRLF and LF are preserved exactly).
 */

export type CharKind =
  | 'space'
  | 'tab'
  | 'nbsp'
  | 'zero-width'
  | 'unicode-space'
  | 'format'
  | 'control'
  | 'line-separator'

export type EolKind = 'LF' | 'CRLF' | 'CR'

export interface InvisibleInfo {
  kind: CharKind
  /** Short label used on chips, e.g. ZWSP, NBSP, EMSP, LRM. */
  abbr: string
  name: string
}

/** Known invisible / special characters with labels. Others fall back to U+XXXX. */
export const SPECIAL_CHARS: Record<number, InvisibleInfo> = {
  0x0020: { kind: 'space', abbr: 'SP', name: 'Space' },
  0x0009: { kind: 'tab', abbr: 'TAB', name: 'Tab' },
  0x00a0: { kind: 'nbsp', abbr: 'NBSP', name: 'No-break space' },
  0x200b: { kind: 'zero-width', abbr: 'ZWSP', name: 'Zero width space' },
  0x200c: { kind: 'zero-width', abbr: 'ZWNJ', name: 'Zero width non-joiner' },
  0x200d: { kind: 'zero-width', abbr: 'ZWJ', name: 'Zero width joiner' },
  0x2060: { kind: 'zero-width', abbr: 'WJ', name: 'Word joiner' },
  0xfeff: { kind: 'zero-width', abbr: 'BOM', name: 'Byte order mark / zero width no-break space' },
  0x180e: { kind: 'zero-width', abbr: 'MVS', name: 'Mongolian vowel separator' },
  0x2000: { kind: 'unicode-space', abbr: 'NQSP', name: 'En quad' },
  0x2001: { kind: 'unicode-space', abbr: 'MQSP', name: 'Em quad' },
  0x2002: { kind: 'unicode-space', abbr: 'ENSP', name: 'En space' },
  0x2003: { kind: 'unicode-space', abbr: 'EMSP', name: 'Em space' },
  0x2004: { kind: 'unicode-space', abbr: '3/MSP', name: 'Three-per-em space' },
  0x2005: { kind: 'unicode-space', abbr: '4/MSP', name: 'Four-per-em space' },
  0x2006: { kind: 'unicode-space', abbr: '6/MSP', name: 'Six-per-em space' },
  0x2007: { kind: 'unicode-space', abbr: 'FSP', name: 'Figure space' },
  0x2008: { kind: 'unicode-space', abbr: 'PSP', name: 'Punctuation space' },
  0x2009: { kind: 'unicode-space', abbr: 'THSP', name: 'Thin space' },
  0x200a: { kind: 'unicode-space', abbr: 'HSP', name: 'Hair space' },
  0x202f: { kind: 'unicode-space', abbr: 'NNBSP', name: 'Narrow no-break space' },
  0x205f: { kind: 'unicode-space', abbr: 'MMSP', name: 'Medium mathematical space' },
  0x3000: { kind: 'unicode-space', abbr: 'IDSP', name: 'Ideographic space' },
  0x1680: { kind: 'unicode-space', abbr: 'OGSP', name: 'Ogham space mark' },
  0x00ad: { kind: 'format', abbr: 'SHY', name: 'Soft hyphen' },
  0x200e: { kind: 'format', abbr: 'LRM', name: 'Left-to-right mark' },
  0x200f: { kind: 'format', abbr: 'RLM', name: 'Right-to-left mark' },
  0x061c: { kind: 'format', abbr: 'ALM', name: 'Arabic letter mark' },
  0x202a: { kind: 'format', abbr: 'LRE', name: 'Left-to-right embedding' },
  0x202b: { kind: 'format', abbr: 'RLE', name: 'Right-to-left embedding' },
  0x202c: { kind: 'format', abbr: 'PDF', name: 'Pop directional formatting' },
  0x202d: { kind: 'format', abbr: 'LRO', name: 'Left-to-right override' },
  0x202e: { kind: 'format', abbr: 'RLO', name: 'Right-to-left override' },
  0x2066: { kind: 'format', abbr: 'LRI', name: 'Left-to-right isolate' },
  0x2067: { kind: 'format', abbr: 'RLI', name: 'Right-to-left isolate' },
  0x2068: { kind: 'format', abbr: 'FSI', name: 'First strong isolate' },
  0x2069: { kind: 'format', abbr: 'PDI', name: 'Pop directional isolate' },
  0x2061: { kind: 'format', abbr: 'FA', name: 'Function application' },
  0x2062: { kind: 'format', abbr: 'IT', name: 'Invisible times' },
  0x2063: { kind: 'format', abbr: 'IS', name: 'Invisible separator' },
  0x2064: { kind: 'format', abbr: 'IP', name: 'Invisible plus' },
  0x2028: { kind: 'line-separator', abbr: 'LSEP', name: 'Line separator' },
  0x2029: { kind: 'line-separator', abbr: 'PSEP', name: 'Paragraph separator' },
  0x0085: { kind: 'line-separator', abbr: 'NEL', name: 'Next line' },
}

const C0_NAMES = ['NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL', 'BS', 'HT', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI', 'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB', 'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US']

export function hexCode(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}

const RE_CF = /^\p{Cf}$/u
const RE_ZS = /^\p{Zs}$/u
const RE_CC = /^\p{Cc}$/u

const cache = new Map<number, InvisibleInfo | null>()

/**
 * Classify a code point. Returns null for ordinary visible characters and for line
 * breaks (LF / CR are handled as line endings).
 */
export function classifyCodePoint(cp: number): InvisibleInfo | null {
  if (cp > 0x20 && cp < 0x7f) return null
  const hit = cache.get(cp)
  if (hit !== undefined) return hit
  let info: InvisibleInfo | null = SPECIAL_CHARS[cp] ?? null
  if (!info && cp !== 0x0a && cp !== 0x0d) {
    const ch = String.fromCodePoint(cp)
    if (RE_CC.test(ch)) info = { kind: 'control', abbr: cp < 0x20 ? C0_NAMES[cp] : cp === 0x7f ? 'DEL' : hexCode(cp), name: cp === 0x7f ? 'Delete' : `Control character ${hexCode(cp)}` }
    else if (RE_ZS.test(ch)) info = { kind: 'unicode-space', abbr: hexCode(cp), name: `Space separator ${hexCode(cp)}` }
    else if (RE_CF.test(ch)) info = { kind: 'format', abbr: hexCode(cp), name: `Format character ${hexCode(cp)}` }
    else if (cp >= 0xfe00 && cp <= 0xfe0f) info = null // variation selectors render with their base
  }
  cache.set(cp, info)
  return info
}

// ── Lines ──────────────────────────────────────────────────────────────────────

export interface LineIndex {
  /** Start offset (UTF-16) of each line. */
  starts: Int32Array
  /** End offset of each line's content (exclusive, before the line ending). */
  ends: Int32Array
  /** 0 = none (last line), 1 = LF, 2 = CRLF, 3 = CR */
  eols: Uint8Array
  count: number
}

export const EOL_CODES: (EolKind | null)[] = [null, 'LF', 'CRLF', 'CR']
export const EOL_TEXT: Record<EolKind, string> = { LF: '\n', CRLF: '\r\n', CR: '\r' }

/** Index line boundaries; LF, CRLF and lone CR all end a line. */
export function indexLines(text: string): LineIndex {
  let cap = 1024
  let starts = new Int32Array(cap)
  let ends = new Int32Array(cap)
  let eols = new Uint8Array(cap)
  let n = 0
  let start = 0
  const push = (end: number, eol: number) => {
    if (n === cap) {
      cap *= 2
      const s2 = new Int32Array(cap)
      s2.set(starts)
      starts = s2
      const e2 = new Int32Array(cap)
      e2.set(ends)
      ends = e2
      const l2 = new Uint8Array(cap)
      l2.set(eols)
      eols = l2
    }
    starts[n] = start
    ends[n] = end
    eols[n] = eol
    n++
  }
  const len = text.length
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i)
    if (c === 10) {
      push(i, 1)
      start = i + 1
    } else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        push(i, 2)
        i++
        start = i + 1
      } else {
        push(i, 3)
        start = i + 1
      }
    }
  }
  push(len, 0)
  return { starts: starts.subarray(0, n), ends: ends.subarray(0, n), eols: eols.subarray(0, n), count: n }
}

// ── Tokenization (for rendering one line) ─────────────────────────────────────

export type LineToken =
  | { t: 'text'; v: string }
  | { t: 'space'; n: number; trailing: boolean }
  | { t: 'tab'; width: number; trailing: boolean }
  | { t: 'special'; cp: number; info: InvisibleInfo; trailing: boolean }

export interface TokenizedLine {
  tokens: LineToken[]
  /** Characters beyond the render limit that were not tokenized. */
  truncated: number
}

const TRAILING_WS = /[\s​⁠﻿]/u

/** Index of the first trailing-whitespace character of a line (line.length if none). */
export function trailingStart(line: string): number {
  let i = line.length
  while (i > 0) {
    const c = line.charCodeAt(i - 1)
    // Treat whitespace and zero-width characters at the end as trailing.
    if (c === 32 || c === 9 || TRAILING_WS.test(line[i - 1])) i--
    else break
  }
  return i
}

/**
 * Split a single line (without its line ending) into renderable tokens. Tabs expand to
 * the next tab stop (in columns). Only the first `maxChars` UTF-16 units are tokenized.
 */
export function tokenizeLine(line: string, tabSize = 4, maxChars = 4000): TokenizedLine {
  const limit = Math.min(line.length, maxChars)
  const trail = trailingStart(line)
  const tokens: LineToken[] = []
  let buf = ''
  let col = 0
  const flush = () => {
    if (buf) tokens.push({ t: 'text', v: buf })
    buf = ''
  }
  let i = 0
  while (i < limit) {
    const cp = line.codePointAt(i)!
    const size = cp > 0xffff ? 2 : 1
    const trailing = i >= trail
    if (cp === 0x20) {
      flush()
      const last = tokens[tokens.length - 1]
      if (last && last.t === 'space' && last.trailing === trailing) last.n++
      else tokens.push({ t: 'space', n: 1, trailing })
      col++
    } else if (cp === 0x09) {
      flush()
      const width = tabSize - (col % tabSize)
      tokens.push({ t: 'tab', width, trailing })
      col += width
    } else {
      const info = classifyCodePoint(cp)
      if (info) {
        flush()
        tokens.push({ t: 'special', cp, info, trailing })
        if (info.kind === 'nbsp' || info.kind === 'unicode-space') col++
      } else {
        buf += size === 2 ? line.slice(i, i + 2) : line[i]
        col++
      }
    }
    i += size
  }
  flush()
  return { tokens, truncated: line.length - limit }
}

// ── Summary ────────────────────────────────────────────────────────────────────

export type SummaryKey = CharKind | 'trailing' | EolKind

export interface Occurrence {
  count: number
  /** 1-based line and column (UTF-16 based column) of the first occurrence. */
  first: { line: number; column: number } | null
}

export interface WhitespaceSummary {
  counts: Record<SummaryKey, Occurrence>
  /** Per specific special char (zero-width, format, unicode spaces, control…): code point → occurrence. */
  specials: Map<number, Occurrence>
  lines: number
  eol: { dominant: EolKind | null; mixed: boolean; finalNewline: boolean }
  /** Lines whose content (rendered) exceeds this many characters. */
  longestLine: number
  hasBom: boolean
  /** Lines whose leading indentation mixes tabs and spaces. */
  mixedIndentLines: number
}

const SUMMARY_KEYS: SummaryKey[] = ['space', 'tab', 'nbsp', 'zero-width', 'unicode-space', 'format', 'control', 'line-separator', 'trailing', 'LF', 'CRLF', 'CR']

function emptyCounts(): Record<SummaryKey, Occurrence> {
  const o = {} as Record<SummaryKey, Occurrence>
  for (const k of SUMMARY_KEYS) o[k] = { count: 0, first: null }
  return o
}

export function summarizeWhitespace(text: string, index: LineIndex = indexLines(text)): WhitespaceSummary {
  const counts = emptyCounts()
  const specials = new Map<number, Occurrence>()
  let longestLine = 0
  let mixedIndentLines = 0
  const hit = (k: SummaryKey, line: number, column: number) => {
    const o = counts[k]
    o.count++
    if (!o.first) o.first = { line, column }
  }
  for (let li = 0; li < index.count; li++) {
    const s = index.starts[li]
    const e = index.ends[li]
    const lineNo = li + 1
    if (e - s > longestLine) longestLine = e - s
    // Trailing whitespace check
    let te = e
    while (te > s) {
      const c = text.charCodeAt(te - 1)
      if (c === 32 || c === 9 || (c > 127 && TRAILING_WS.test(text[te - 1]))) te--
      else break
    }
    if (te < e) hit('trailing', lineNo, te - s + 1)
    // Mixed indentation
    let sawSpace = false
    let sawTab = false
    for (let i = s; i < e; i++) {
      const c = text.charCodeAt(i)
      if (c === 32) sawSpace = true
      else if (c === 9) sawTab = true
      else break
    }
    if (sawSpace && sawTab) mixedIndentLines++
    // Characters
    for (let i = s; i < e; i++) {
      const c = text.charCodeAt(i)
      if (c > 32 && c < 127) continue
      if (c === 32) {
        hit('space', lineNo, i - s + 1)
        continue
      }
      if (c === 9) {
        hit('tab', lineNo, i - s + 1)
        continue
      }
      const cp = text.codePointAt(i)!
      if (cp > 0xffff) {
        // Astral: may still be a format char (e.g. tag characters U+E0001…)
        const info = classifyCodePoint(cp)
        if (info) recordSpecial(cp, info.kind, lineNo, i - s + 1)
        i++
        continue
      }
      const info = classifyCodePoint(cp)
      if (info) recordSpecial(cp, info.kind, lineNo, i - s + 1)
    }
    const eol = EOL_CODES[index.eols[li]]
    if (eol) hit(eol, lineNo, e - s + 1)
  }
  function recordSpecial(cp: number, kind: CharKind, line: number, column: number) {
    hit(kind, line, column)
    let o = specials.get(cp)
    if (!o) specials.set(cp, (o = { count: 0, first: { line, column } }))
    o.count++
  }

  const eolCounts: [EolKind, number][] = [
    ['LF', counts.LF.count],
    ['CRLF', counts.CRLF.count],
    ['CR', counts.CR.count],
  ]
  const used = eolCounts.filter(([, n]) => n > 0)
  const dominant = used.length ? used.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null
  return {
    counts,
    specials,
    lines: text === '' ? 0 : index.count,
    eol: { dominant, mixed: used.length > 1, finalNewline: index.count > 1 && index.ends[index.count - 1] === index.starts[index.count - 1] },
    longestLine,
    hasBom: text.charCodeAt(0) === 0xfeff,
    mixedIndentLines,
  }
}

// ── Cleanups ───────────────────────────────────────────────────────────────────

export interface CleanupOptions {
  removeZeroWidth?: boolean
  /** Keep ZWJ between emoji/pictographs (👩‍💻) and ZWNJ/ZWJ between letters of scripts that need them. */
  keepEmojiZwj?: boolean
  nbspToSpace?: boolean
  unicodeSpacesToSpace?: boolean
  removeFormatChars?: boolean
  trimTrailing?: boolean
  normalizeEol?: EolKind | null
  tabs?: 'to-spaces' | 'to-tabs' | null
  tabSize?: number
}

const ZERO_WIDTH_RE = /[​‌‍⁠﻿᠎]/g
const EMOJI_ZWJ_RE = /(\p{Extended_Pictographic}\p{M}*[︎️]?[\u{1f3fb}-\u{1f3ff}]?)‍(?=\p{Extended_Pictographic})/gu
const ZWJ_PLACEHOLDER = '\u0000ZWJ\u0000'

export function removeZeroWidth(text: string, keepEmojiZwj = true): string {
  if (!keepEmojiZwj) return text.replace(ZERO_WIDTH_RE, '')
  // Protect ZWJ inside emoji sequences, remove the rest. NUL never appears in the placeholder's
  // surroundings: if the input already contains our placeholder, fall back to a slower path.
  if (text.includes(ZWJ_PLACEHOLDER)) {
    let out = ''
    const chars = Array.from(text)
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]
      if (c === '‍' && i > 0 && i + 1 < chars.length && /\p{Extended_Pictographic}|[️\u{1f3fb}-\u{1f3ff}]/u.test(chars[i - 1]) && /\p{Extended_Pictographic}/u.test(chars[i + 1])) out += c
      else if (!/[​‌‍⁠﻿᠎]/.test(c)) out += c
    }
    return out
  }
  return text.replace(EMOJI_ZWJ_RE, `$1${ZWJ_PLACEHOLDER}`).replace(ZERO_WIDTH_RE, '').split(ZWJ_PLACEHOLDER).join('‍')
}

export function nbspToSpace(text: string): string {
  return text.replace(/[   ]/g, ' ')
}

export function unicodeSpacesToSpace(text: string): string {
  return text.replace(/[  -  　]/g, ' ')
}

export function removeFormatChars(text: string): string {
  // Bidi controls, soft hyphen and other Cf characters except zero-width joiners (handled separately).
  return text.replace(/[­؜‎‏‪-‮⁡-⁤⁦-⁩]/g, '')
}

export function trimTrailingWhitespace(text: string): string {
  return text.replace(/[ \t   -​  ⁠　﻿]+(?=\r\n|\r|\n|$)/g, '')
}

export function normalizeLineEndings(text: string, eol: EolKind): string {
  return text.replace(/\r\n|\r|\n/g, EOL_TEXT[eol])
}

/** Expand tabs to spaces, respecting tab stops. */
export function tabsToSpaces(text: string, tabSize = 4): string {
  if (!text.includes('\t')) return text
  return text.replace(/[^\r\n]+/g, (line) => {
    if (!line.includes('\t')) return line
    let out = ''
    let col = 0
    for (const ch of line) {
      if (ch === '\t') {
        const w = tabSize - (col % tabSize)
        out += ' '.repeat(w)
        col += w
      } else {
        out += ch
        col++
      }
    }
    return out
  })
}

/** Convert leading indentation to tabs (only indentation — alignment inside lines is kept). */
export function spacesToTabs(text: string, tabSize = 4): string {
  return text.replace(/^[ \t]+/gm, (indent) => {
    let col = 0
    for (const ch of indent) col = ch === '\t' ? col + tabSize - (col % tabSize) : col + 1
    return '\t'.repeat(Math.floor(col / tabSize)) + ' '.repeat(col % tabSize)
  })
}

export function applyCleanups(text: string, o: CleanupOptions): string {
  let s = text
  const tab = o.tabSize ?? 4
  if (o.removeZeroWidth) s = removeZeroWidth(s, o.keepEmojiZwj ?? true)
  if (o.removeFormatChars) s = removeFormatChars(s)
  if (o.nbspToSpace) s = nbspToSpace(s)
  if (o.unicodeSpacesToSpace) s = unicodeSpacesToSpace(s)
  if (o.tabs === 'to-spaces') s = tabsToSpaces(s, tab)
  else if (o.tabs === 'to-tabs') s = spacesToTabs(s, tab)
  if (o.trimTrailing) s = trimTrailingWhitespace(s)
  if (o.normalizeEol) s = normalizeLineEndings(s, o.normalizeEol)
  return s
}

export function hasAnyCleanup(o: CleanupOptions): boolean {
  return !!(o.removeZeroWidth || o.removeFormatChars || o.nbspToSpace || o.unicodeSpacesToSpace || o.trimTrailing || o.normalizeEol || o.tabs)
}
