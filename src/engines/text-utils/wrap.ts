/**
 * Hard-wrap and unwrap text.
 *
 * Width model: columns are counted per grapheme cluster. East Asian Wide/Fullwidth
 * characters and emoji count as 2 columns, combining marks and zero-width characters as
 * 0, everything else as 1. Tabs count as advancing to the next multiple of `tabSize`
 * (only relevant in indentation). This matches how monospace terminals and editors lay
 * out text in most cases; ambiguous-width characters (e.g. some Greek/Cyrillic in CJK
 * fonts) are counted as 1.
 */

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/
const RE_EMOJI_PRES = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u
const RE_ZERO_WIDTH = /^(?:\p{M}|\p{Cf}|[​⁠﻿])+$/u

/** East Asian Wide (W) and Fullwidth (F) ranges (condensed from EastAsianWidth.txt). */
const WIDE_RANGES: [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe],
  [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
  [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
  [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755],
  [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16fe4], [0x17000, 0x18cff],
  [0x1b000, 0x1b2ff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f202],
  [0x1f210, 0x1f23b], [0x1f240, 0x1f248], [0x1f250, 0x1f251], [0x1f260, 0x1f265], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff],
  [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
]

export function isWideCodePoint(cp: number): boolean {
  if (cp < 0x1100) return false
  let lo = 0
  let hi = WIDE_RANGES.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [a, b] = WIDE_RANGES[mid]
    if (cp < a) hi = mid - 1
    else if (cp > b) lo = mid + 1
    else return true
  }
  return false
}

let seg: Intl.Segmenter | null | undefined
function graphemes(s: string): string[] {
  if (seg === undefined) seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  if (!seg) return Array.from(s)
  const out: string[] = []
  for (const g of seg.segment(s)) out.push(g.segment)
  return out
}

export function graphemeWidth(g: string): number {
  if (g.length === 1) {
    const c = g.charCodeAt(0)
    if (c >= 0x20 && c < 0x7f) return 1
    if (c < 0x20 || c === 0x7f) return 0
  }
  if (RE_ZERO_WIDTH.test(g)) return 0
  const cp = g.codePointAt(0)!
  if (isWideCodePoint(cp)) return 2
  if (RE_EMOJI_PRES.test(g)) return 2
  return 1
}

/** Display width in terminal columns (see module comment). */
export function displayWidth(s: string): number {
  if (ASCII_PRINTABLE.test(s)) return s.length
  let w = 0
  for (const g of graphemes(s)) w += g === '\t' ? 4 : graphemeWidth(g)
  return w
}

/** Width of leading indentation with tab stops. */
function indentWidth(s: string, tabSize: number): number {
  let col = 0
  for (const ch of s) col = ch === '\t' ? col + tabSize - (col % tabSize) : col + displayWidth(ch)
  return col
}

// ── Shared parsing ─────────────────────────────────────────────────────────────

export function detectEol(text: string): '\n' | '\r\n' | '\r' {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  const cr = (text.match(/\r(?!\n)/g) ?? []).length
  if (crlf >= lf && crlf >= cr && crlf > 0) return '\r\n'
  if (cr > lf) return '\r'
  return '\n'
}

const PREFIX_RE = /^[ \t]*(?:\/\/+!?|#+(?!\S)|>+|--+|;+|%+|\*(?!\S)|'(?!\S)|REM\b)[ \t]?/

/**
 * Detect a comment/quote prefix shared by every non-blank line, e.g. "// ", "# ", "> ",
 * " * ". Returns '' if lines don't agree.
 */
export function detectPrefix(lines: string[]): string {
  let prefix: string | null = null
  for (const line of lines) {
    if (!line.trim()) continue
    const m = PREFIX_RE.exec(line)
    if (!m) return ''
    if (prefix === null) prefix = m[0]
    else if (m[0] !== prefix) {
      // Allow "//" vs "// " differences (blank comment lines): keep the longer common form.
      if (m[0].trimEnd() === prefix.trimEnd()) prefix = m[0].length > prefix.length ? m[0] : prefix
      else return ''
    }
  }
  return prefix ?? ''
}

function stripPrefix(line: string, prefix: string): string {
  if (!prefix) return line
  if (line.startsWith(prefix)) return line.slice(prefix.length)
  const bare = prefix.trimEnd()
  if (line.trimEnd() === bare) return ''
  if (line.startsWith(bare)) return line.slice(bare.length)
  return line
}

const LIST_RE = /^([ \t]*)([-*+•]|\d{1,9}[.)]|[a-zA-Z][.)])([ \t]+)(\[[ xX]\][ \t]+)?/
const FENCE_RE = /^[ \t]*(```|~~~)/

type Block =
  | { kind: 'blank' }
  | { kind: 'verbatim'; lines: string[] }
  | { kind: 'para'; lines: string[]; list: boolean }

function parseBlocks(lines: string[], splitLists: boolean, eachLine: boolean): Block[] {
  const blocks: Block[] = []
  let cur: { kind: 'para'; lines: string[]; list: boolean } | null = null
  let fence: string | null = null
  let fenceLines: string[] = []
  for (const line of lines) {
    if (fence) {
      fenceLines.push(line)
      if (line.trim().startsWith(fence)) {
        blocks.push({ kind: 'verbatim', lines: fenceLines })
        fence = null
        fenceLines = []
      }
      continue
    }
    const fm = FENCE_RE.exec(line)
    if (fm) {
      cur = null
      fence = fm[1]
      fenceLines = [line]
      continue
    }
    if (!line.trim()) {
      cur = null
      blocks.push({ kind: 'blank' })
      continue
    }
    const isList = splitLists && LIST_RE.test(line)
    if (!cur || isList || eachLine) {
      cur = { kind: 'para', lines: [line], list: isList }
      blocks.push(cur)
    } else cur.lines.push(line)
  }
  if (fence) blocks.push({ kind: 'verbatim', lines: fenceLines })
  return blocks
}

// ── Wrap ───────────────────────────────────────────────────────────────────────

export interface WrapOptions {
  width: number
  /** Split words longer than the available width. */
  breakLongWords: boolean
  /** Keep blank-line paragraph breaks (otherwise all text becomes one paragraph). */
  preserveParagraphs: boolean
  /** Keep each paragraph's leading indentation on every wrapped line. */
  preserveIndent: boolean
  /** Join the lines of a paragraph before wrapping (reflow). Off = only split long lines. */
  reflow: boolean
  /** Prefix added to every output line, e.g. "// ". Existing occurrences are stripped first. */
  prefix: string
  /** Detect a shared prefix ("// ", "# ", "> ") when `prefix` is empty. */
  detectPrefix: boolean
  tabSize: number
}

export const DEFAULT_WRAP: WrapOptions = {
  width: 80,
  breakLongWords: false,
  preserveParagraphs: true,
  preserveIndent: true,
  reflow: true,
  prefix: '',
  detectPrefix: true,
  tabSize: 4,
}

export interface WrapResult {
  text: string
  /** The prefix applied (explicit or detected). */
  prefix: string
  detected: boolean
  /** Output lines wider than the target width (unbreakable words). */
  overflowLines: number
  maxWidth: number
}

function splitWord(word: string, size: number): string[] {
  const out: string[] = []
  let cur = ''
  let w = 0
  for (const g of graphemes(word)) {
    const gw = graphemeWidth(g)
    if (w + gw > size && cur) {
      out.push(cur)
      cur = ''
      w = 0
    }
    cur += g
    w += gw
  }
  if (cur) out.push(cur)
  return out
}

export interface WrapToken {
  text: string
  /** True when there is no space between this token and the previous one (CJK break opportunity). */
  attach: boolean
}

const RE_CJK_BREAKABLE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff01-\uff60]/u
const RE_CJK_END = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff01-\uff60]$/u
/** Characters that must not start a line (kinsoku): closing brackets, small kana, punctuation. */
const RE_NO_BREAK_BEFORE = /^[、。，．！？：；」』）〕〉》】〙〗ー～…‥・ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ,.!?:;)\]}]/u
/** Characters that must not end a line: opening brackets. */
const RE_NO_BREAK_AFTER = /[「『（〔〈《【〘〖([{]$/u

/**
 * Split text into wrap tokens. Words are separated by spaces/tabs; in addition, lines may
 * break between CJK characters (which are written without spaces), honouring basic
 * kinsoku rules for punctuation.
 */
export function tokenizeForWrap(text: string): WrapToken[] {
  const tokens: WrapToken[] = []
  for (const chunk of text.split(/[ \t]+/)) {
    if (!chunk) continue
    if (!RE_CJK_BREAKABLE.test(chunk) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(chunk)) {
      tokens.push({ text: chunk, attach: false })
      continue
    }
    let cur = ''
    let first = true
    let prevCjk = false
    for (const g of graphemes(chunk)) {
      const cjk = RE_CJK_BREAKABLE.test(g)
      const canBreak = cur !== '' && (cjk || prevCjk) && !RE_NO_BREAK_BEFORE.test(g) && !RE_NO_BREAK_AFTER.test(cur)
      if (canBreak) {
        tokens.push({ text: cur, attach: !first })
        first = false
        cur = ''
      }
      cur += g
      prevCjk = cjk
    }
    if (cur) tokens.push({ text: cur, attach: !first })
  }
  return tokens
}

/** Greedy line filling. `first`/`rest` are the available widths for the first and following lines. */
export function fillWords(words: (string | WrapToken)[], first: number, rest: number, breakLong: boolean): string[] {
  const lines: string[] = []
  let line = ''
  let lw = 0
  const avail = () => Math.max(1, lines.length === 0 ? first : rest)
  for (const item of words) {
    const word = typeof item === 'string' ? item : item.text
    const attach = typeof item === 'string' ? false : item.attach
    const ww = displayWidth(word)
    const gap = attach ? 0 : 1
    if (line && lw + gap + ww <= avail()) {
      line += (attach ? '' : ' ') + word
      lw += gap + ww
      continue
    }
    if (line) {
      lines.push(line)
      line = ''
      lw = 0
    }
    if (ww > avail() && breakLong) {
      let rem = word
      while (rem && displayWidth(rem) > avail()) {
        const head = splitWord(rem, avail())[0]
        lines.push(head)
        rem = rem.slice(head.length)
      }
      line = rem
      lw = displayWidth(rem)
    } else {
      line = word
      lw = ww
    }
  }
  if (line) lines.push(line)
  return lines
}

function resolvePrefix(lines: string[], explicit: string, detect: boolean): { prefix: string; detected: boolean } {
  if (explicit) return { prefix: explicit, detected: false }
  if (detect) {
    const p = detectPrefix(lines)
    if (p) return { prefix: p, detected: true }
  }
  return { prefix: '', detected: false }
}

export function wrapText(text: string, options: Partial<WrapOptions> = {}): WrapResult {
  const o = { ...DEFAULT_WRAP, ...options }
  const width = Math.max(1, Math.floor(o.width))
  const eol = detectEol(text)
  const rawLines = text.split(/\r\n|\r|\n/)
  const { prefix, detected } = resolvePrefix(rawLines, o.prefix, o.detectPrefix)
  const lines = rawLines.map((l) => stripPrefix(l, prefix))
  const blankPrefix = prefix.trimEnd()
  const prefixWidth = displayWidth(prefix.replace(/\t/g, ' '.repeat(o.tabSize)))

  let blocks = parseBlocks(lines, true, !o.reflow)
  if (!o.preserveParagraphs) {
    // Merge all prose into one paragraph (list items and code blocks stay separate).
    const merged: Block[] = []
    for (const b of blocks) {
      if (b.kind === 'blank') continue
      const last = merged[merged.length - 1]
      if (b.kind === 'para' && !b.list && last && last.kind === 'para') last.lines.push(...b.lines)
      else merged.push(b.kind === 'para' ? { ...b, lines: [...b.lines] } : b)
    }
    blocks = merged
  }

  const out: string[] = []
  for (const b of blocks) {
    if (b.kind === 'blank') {
      out.push(blankPrefix)
      continue
    }
    if (b.kind === 'verbatim') {
      for (const l of b.lines) out.push(l ? prefix + l : blankPrefix)
      continue
    }
    const firstLine = b.lines[0]
    const lead = /^[ \t]*/.exec(firstLine)![0]
    let indent = o.preserveIndent ? lead : ''
    let marker = ''
    let hang = indent
    if (b.list) {
      const m = LIST_RE.exec(firstLine)!
      marker = m[2] + m[3] + (m[4] ?? '')
      if (!o.preserveIndent) indent = ''
      hang = indent + ' '.repeat(displayWidth(marker))
    }
    const body = b.lines.map((l, i) => (i === 0 ? l.slice(b.list ? LIST_RE.exec(firstLine)![0].length : lead.length) : l)).join(' ')
    const words = tokenizeForWrap(body)
    const firstAvail = width - prefixWidth - indentWidth(indent, o.tabSize) - displayWidth(marker)
    const restAvail = width - prefixWidth - indentWidth(hang, o.tabSize)
    const filled = words.length ? fillWords(words, firstAvail, restAvail, o.breakLongWords) : ['']
    filled.forEach((l, i) => out.push(prefix + (i === 0 ? indent + marker : hang) + l))
  }

  let overflowLines = 0
  let maxWidth = 0
  for (const l of out) {
    const w = displayWidth(l.replace(/\t/g, ' '.repeat(o.tabSize)))
    if (w > maxWidth) maxWidth = w
    if (w > width) overflowLines++
  }
  return { text: out.join(eol), prefix, detected, overflowLines, maxWidth }
}

// ── Unwrap ─────────────────────────────────────────────────────────────────────

export interface UnwrapOptions {
  /** Keep list items (-, *, 1.) on their own lines. */
  keepListItems: boolean
  /** "infor-⏎mation" → "information" when a line ends in a hyphen after a letter. */
  joinHyphenated: boolean
  /** Detect and keep a shared comment/quote prefix. */
  detectPrefix: boolean
  /** Keep the first line's indentation for each paragraph. */
  preserveIndent: boolean
}

export const DEFAULT_UNWRAP: UnwrapOptions = { keepListItems: true, joinHyphenated: false, detectPrefix: true, preserveIndent: true }

export interface UnwrapResult {
  text: string
  prefix: string
  paragraphs: number
  joinedLines: number
}

export function unwrapText(text: string, options: Partial<UnwrapOptions> = {}): UnwrapResult {
  const o = { ...DEFAULT_UNWRAP, ...options }
  const eol = detectEol(text)
  const rawLines = text.split(/\r\n|\r|\n/)
  const prefix = o.detectPrefix ? detectPrefix(rawLines) : ''
  const lines = rawLines.map((l) => stripPrefix(l, prefix))
  const blankPrefix = prefix.trimEnd()
  const blocks = parseBlocks(lines, o.keepListItems, false)
  const out: string[] = []
  let paragraphs = 0
  let joinedLines = 0
  for (const b of blocks) {
    if (b.kind === 'blank') {
      out.push(blankPrefix)
      continue
    }
    if (b.kind === 'verbatim') {
      for (const l of b.lines) out.push(l ? prefix + l : blankPrefix)
      continue
    }
    paragraphs++
    joinedLines += b.lines.length - 1
    const lead = o.preserveIndent ? /^[ \t]*/.exec(b.lines[0])![0] : ''
    let acc = b.lines[0].trim()
    for (let i = 1; i < b.lines.length; i++) {
      const next = b.lines[i].trim()
      if (o.joinHyphenated && /\p{L}-$/u.test(acc) && /^\p{Ll}/u.test(next)) acc = acc.slice(0, -1) + next
      else if (RE_CJK_END.test(acc) && RE_CJK_BREAKABLE.test(next)) acc = acc + next // CJK is written without spaces
      else acc = acc + ' ' + next
    }
    out.push(prefix + lead + acc)
  }
  return { text: out.join(eol), prefix, paragraphs, joinedLines }
}

/** Width statistics of text (for the status bar). */
export function lineWidthStats(text: string, limit: number, tabSize = 4): { longest: number; over: number; lines: number } {
  let longest = 0
  let over = 0
  const lines = text.split(/\r\n|\r|\n/)
  for (const l of lines) {
    const w = displayWidth(l.includes('\t') ? l.replace(/\t/g, ' '.repeat(tabSize)) : l)
    if (w > longest) longest = w
    if (w > limit) over++
  }
  return { longest, over, lines: lines.length }
}
