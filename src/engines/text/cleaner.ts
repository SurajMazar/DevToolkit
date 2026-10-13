/**
 * Text Cleaner: an ordered pipeline of small, well-defined text operations.
 * Every operation reports what it did, so the UI can show a per-step effect summary.
 */
import { countEols, mapLines, reorderLines, splitLines } from './lines'
import { stripHtml } from './html'

// ── Operation definitions ──────────────────────────────────────────────────────────

export type ExtractKind = 'numbers' | 'letters' | 'emails' | 'urls' | 'hashtags' | 'mentions'
export type Eol = 'lf' | 'crlf' | 'cr'

export type CleanerOp =
  | { kind: 'trim' }
  | { kind: 'trimLines'; side: 'both' | 'start' | 'end' }
  | { kind: 'collapseSpaces'; includeTabs: boolean; keepIndent: boolean }
  | { kind: 'removeBlankLines'; mode: 'all' | 'collapse'; whitespaceIsBlank: boolean }
  | { kind: 'dedupeLines'; caseInsensitive: boolean; ignoreWhitespace: boolean; keepBlank: boolean }
  | { kind: 'sortLines'; order: 'asc' | 'desc'; natural: boolean; locale: boolean; caseInsensitive: boolean }
  | { kind: 'reverseLines' }
  | { kind: 'reverseWords' }
  | { kind: 'reverseText' }
  | { kind: 'addLineNumbers'; start: number; pad: 'none' | 'zero' | 'space'; separator: string; skipBlank: boolean }
  | { kind: 'removeLineNumbers' }
  | { kind: 'prefixSuffix'; prefix: string; suffix: string; skipBlank: boolean }
  | { kind: 'tabsToSpaces'; size: number; tabStops: boolean }
  | { kind: 'spacesToTabs'; size: number; scope: 'leading' | 'all' }
  | { kind: 'lineEndings'; eol: Eol }
  | { kind: 'stripHtml'; decodeEntities: boolean; blockNewlines: boolean }
  | { kind: 'removeSpecial'; keepPunctuation: boolean; extra: string }
  | { kind: 'removeNumbers' }
  | { kind: 'removePunctuation'; symbols: boolean; keepApostrophes: boolean }
  | { kind: 'normalizeUnicode'; form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD' }
  | { kind: 'extract'; what: ExtractKind; dedupe: boolean }

export type OpKind = CleanerOp['kind']
type OpOf<K extends OpKind> = Extract<CleanerOp, { kind: K }>

export interface OpInfo {
  kind: OpKind
  label: string
  group: 'Whitespace' | 'Lines' | 'Order' | 'Characters' | 'Extract' | 'Format'
  description: string
  /** Default parameters for a newly added step. */
  defaults: CleanerOp
}

export const OPS: OpInfo[] = [
  { kind: 'trim', group: 'Whitespace', label: 'Trim text', description: 'Remove leading and trailing whitespace from the whole text', defaults: { kind: 'trim' } },
  { kind: 'trimLines', group: 'Whitespace', label: 'Trim each line', description: 'Remove whitespace at the start and/or end of every line', defaults: { kind: 'trimLines', side: 'both' } },
  { kind: 'collapseSpaces', group: 'Whitespace', label: 'Collapse spaces', description: 'Replace runs of spaces with a single space', defaults: { kind: 'collapseSpaces', includeTabs: true, keepIndent: true } },
  { kind: 'tabsToSpaces', group: 'Whitespace', label: 'Tabs → spaces', description: 'Replace tab characters with spaces', defaults: { kind: 'tabsToSpaces', size: 4, tabStops: true } },
  { kind: 'spacesToTabs', group: 'Whitespace', label: 'Spaces → tabs', description: 'Replace groups of spaces with tabs', defaults: { kind: 'spacesToTabs', size: 4, scope: 'leading' } },
  { kind: 'lineEndings', group: 'Whitespace', label: 'Normalize line endings', description: 'Convert every line break to LF, CRLF or CR', defaults: { kind: 'lineEndings', eol: 'lf' } },

  { kind: 'removeBlankLines', group: 'Lines', label: 'Remove blank lines', description: 'Drop empty lines, or collapse runs of them into one', defaults: { kind: 'removeBlankLines', mode: 'all', whitespaceIsBlank: true } },
  { kind: 'dedupeLines', group: 'Lines', label: 'Remove duplicate lines', description: 'Keep the first occurrence of each line', defaults: { kind: 'dedupeLines', caseInsensitive: false, ignoreWhitespace: true, keepBlank: true } },
  { kind: 'addLineNumbers', group: 'Lines', label: 'Add line numbers', description: 'Prefix each line with its number', defaults: { kind: 'addLineNumbers', start: 1, pad: 'none', separator: '. ', skipBlank: false } },
  { kind: 'removeLineNumbers', group: 'Lines', label: 'Remove line numbers', description: 'Strip leading “1.”, “2)”, “3:”, “[4]” style numbering', defaults: { kind: 'removeLineNumbers' } },
  { kind: 'prefixSuffix', group: 'Lines', label: 'Add prefix / suffix', description: 'Wrap every line with text', defaults: { kind: 'prefixSuffix', prefix: '- ', suffix: '', skipBlank: true } },

  { kind: 'sortLines', group: 'Order', label: 'Sort lines', description: 'Alphabetical, natural (file2 < file10) and locale-aware sorting', defaults: { kind: 'sortLines', order: 'asc', natural: true, locale: true, caseInsensitive: true } },
  { kind: 'reverseLines', group: 'Order', label: 'Reverse line order', description: 'Last line first', defaults: { kind: 'reverseLines' } },
  { kind: 'reverseWords', group: 'Order', label: 'Reverse words', description: 'Reverse the order of words on each line', defaults: { kind: 'reverseWords' } },
  { kind: 'reverseText', group: 'Order', label: 'Reverse text', description: 'Reverse every character (emoji-safe)', defaults: { kind: 'reverseText' } },

  { kind: 'stripHtml', group: 'Characters', label: 'Strip HTML tags', description: 'Keep only the text content of HTML', defaults: { kind: 'stripHtml', decodeEntities: true, blockNewlines: true } },
  { kind: 'removeSpecial', group: 'Characters', label: 'Remove special characters', description: 'Keep letters, digits, whitespace and basic punctuation', defaults: { kind: 'removeSpecial', keepPunctuation: true, extra: '' } },
  { kind: 'removePunctuation', group: 'Characters', label: 'Remove punctuation', description: 'Remove punctuation marks (and optionally symbols)', defaults: { kind: 'removePunctuation', symbols: false, keepApostrophes: true } },
  { kind: 'removeNumbers', group: 'Characters', label: 'Remove numbers', description: 'Remove digits and numbers like 3.14 or 1,000', defaults: { kind: 'removeNumbers' } },
  { kind: 'normalizeUnicode', group: 'Characters', label: 'Normalize Unicode', description: 'Compose or decompose characters (NFC, NFD, NFKC, NFKD)', defaults: { kind: 'normalizeUnicode', form: 'NFC' } },

  { kind: 'extract', group: 'Extract', label: 'Extract', description: 'Output only matching items, one per line', defaults: { kind: 'extract', what: 'emails', dedupe: true } },
]

export const OP_INFO = new Map(OPS.map((o) => [o.kind, o]))

export const EXTRACT_LABELS: Record<ExtractKind, { label: string; noun: [string, string] }> = {
  emails: { label: 'Email addresses', noun: ['email', 'emails'] },
  urls: { label: 'URLs', noun: ['URL', 'URLs'] },
  hashtags: { label: '#hashtags', noun: ['hashtag', 'hashtags'] },
  mentions: { label: '@mentions', noun: ['mention', 'mentions'] },
  numbers: { label: 'Numbers', noun: ['number', 'numbers'] },
  letters: { label: 'Words (letters only)', noun: ['word', 'words'] },
}

// ── Helpers ───────────────────────────────────────────────────────────────────────

export interface StepResult {
  text: string
  /** Human readable effect, e.g. "removed 12 lines". */
  summary: string
  changed: boolean
}

const fmt = new Intl.NumberFormat('en-US')
const plural = (n: number, one: string, many = `${one}s`) => `${fmt.format(n)} ${n === 1 ? one : many}`

function result(before: string, text: string, summary: string): StepResult {
  return { text, summary: text === before ? 'no change' : summary, changed: text !== before }
}

let graphemeSegmenter: Intl.Segmenter | null | undefined
function graphemes(text: string): string[] {
  if (graphemeSegmenter === undefined) graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  if (!graphemeSegmenter) return Array.from(text)
  const out: string[] = []
  for (const s of graphemeSegmenter.segment(text)) out.push(s.segment)
  return out
}

/** Reverses a string by grapheme cluster, so emoji sequences, flags and combining marks stay intact. */
export function reverseGraphemes(text: string): string {
  return graphemes(text).reverse().join('')
}

/** Natural compare by code point: runs of digits compare numerically ("file2" < "file10"). */
export function naturalCompare(a: string, b: string, caseInsensitive = false): number {
  if (caseInsensitive) {
    a = a.toLowerCase()
    b = b.toLowerCase()
  }
  const re = /(\d+)|(\D+)/g
  const ta = a.match(re) ?? []
  const tb = b.match(re) ?? []
  const len = Math.min(ta.length, tb.length)
  for (let i = 0; i < len; i++) {
    const x = ta[i]
    const y = tb[i]
    if (x === y) continue
    const dx = x.charCodeAt(0) >= 48 && x.charCodeAt(0) <= 57
    const dy = y.charCodeAt(0) >= 48 && y.charCodeAt(0) <= 57
    if (dx && dy) {
      const nx = x.replace(/^0+(?=\d)/, '')
      const ny = y.replace(/^0+(?=\d)/, '')
      if (nx.length !== ny.length) return nx.length - ny.length
      if (nx !== ny) return nx < ny ? -1 : 1
      if (x.length !== y.length) return x.length - y.length
      continue
    }
    return x < y ? -1 : 1
  }
  return ta.length - tb.length
}

export function makeLineComparator(o: { natural: boolean; locale: boolean; caseInsensitive: boolean }): (a: string, b: string) => number {
  if (o.locale) {
    const collator = new Intl.Collator(undefined, { numeric: o.natural, sensitivity: o.caseInsensitive ? 'accent' : 'variant' })
    return collator.compare
  }
  if (o.natural) return (a, b) => naturalCompare(a, b, o.caseInsensitive)
  if (o.caseInsensitive) {
    return (a, b) => {
      const x = a.toLowerCase()
      const y = b.toLowerCase()
      return x < y ? -1 : x > y ? 1 : 0
    }
  }
  return (a, b) => (a < b ? -1 : a > b ? 1 : 0)
}

const isBlank = (line: string, whitespaceIsBlank = true) => (whitespaceIsBlank ? line.trim() === '' : line === '')

// Extraction patterns.
const RE_EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)*\.\p{L}{2,}/gu
const RE_URL = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"'`]+/giu
const RE_HASHTAG = /(?<![\p{L}\p{N}_&#/])#[\p{L}\p{N}_]*\p{L}[\p{L}\p{M}\p{N}_]*/gu
const RE_MENTION = /(?<![\p{L}\p{N}_.@])@[\p{L}\p{N}_](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_])?/gu
const RE_NUMBER = /(?:(?<![\p{L}\p{N}_])[-+](?=\d)|(?<![\p{L}\p{N}_.]))(?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?/gu
const RE_LETTERS = /\p{L}[\p{L}\p{M}]*/gu

/** Trims trailing punctuation from a URL, keeping balanced closing brackets ("…/Foo_(bar)"). */
function cleanUrl(u: string): string {
  let s = u.replace(/[.,;:!?…]+$/u, '')
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
    while (s.endsWith(close)) {
      const opens = s.split(open).length - 1
      const closes = s.split(close).length - 1
      if (closes > opens) s = s.slice(0, -1).replace(/[.,;:!?…]+$/u, '')
      else break
    }
  }
  return s
}

export function extractItems(text: string, what: ExtractKind): string[] {
  switch (what) {
    case 'emails':
      return Array.from(text.matchAll(RE_EMAIL), (m) => m[0].replace(/^[.]+/, ''))
    case 'urls':
      return Array.from(text.matchAll(RE_URL), (m) => cleanUrl(m[0])).filter((u) => u.length > 4)
    case 'hashtags':
      return Array.from(text.matchAll(RE_HASHTAG), (m) => m[0])
    case 'mentions':
      return Array.from(text.matchAll(RE_MENTION), (m) => m[0])
    case 'numbers':
      return Array.from(text.matchAll(RE_NUMBER), (m) => m[0])
    case 'letters':
      return Array.from(text.matchAll(RE_LETTERS), (m) => m[0])
  }
}

// Line number patterns: "12. ", "12) ", "12: ", "[12] ", "(12) ", "12 | ", "12\t", "12 - ".
const RE_LINE_NUMBER_STRICT = /^[ \t]*(?:\[\d+\]|\(\d+\)|\d+(?:[.):]|[ \t]*[|\-–:][ \t]?|\t))[ \t]?/
const RE_LINE_NUMBER_LOOSE = /^[ \t]*\d+[ \t]/

// ── Operations ────────────────────────────────────────────────────────────────────

type Impl<K extends OpKind> = (text: string, op: OpOf<K>) => StepResult

const impls: { [K in OpKind]: Impl<K> } = {
  trim(text) {
    const t = text.trim()
    return result(text, t, `removed ${plural(text.length - t.length, 'character')}`)
  },

  trimLines(text, op) {
    let n = 0
    const fn = op.side === 'start' ? (l: string) => l.trimStart() : op.side === 'end' ? (l: string) => l.trimEnd() : (l: string) => l.trim()
    const t = mapLines(text, (l) => {
      const r = fn(l)
      if (r !== l) n++
      return r
    })
    return result(text, t, `trimmed ${plural(n, 'line')}`)
  },

  collapseSpaces(text, op) {
    let runs = 0
    const re = op.includeTabs ? /[ \t  -   　]{2,}|\t| /g : / {2,}/g
    const collapse = (s: string) =>
      s.replace(re, (m) => {
        if (m === ' ') return m
        runs++
        return ' '
      })
    const t = mapLines(text, (l) => {
      if (!op.keepIndent) return collapse(l)
      const indent = /^[ \t]*/.exec(l)![0]
      if (indent.length === l.length) return l
      return indent + collapse(l.slice(indent.length))
    })
    return result(text, t, `collapsed ${plural(runs, 'run')}`)
  },

  removeBlankLines(text, op) {
    let removed = 0
    let prevBlank = false
    const t = mapLines(text, (l) => {
      const blank = isBlank(l, op.whitespaceIsBlank)
      if (!blank) {
        prevBlank = false
        return l
      }
      if (op.mode === 'collapse' && !prevBlank) {
        prevBlank = true
        return l
      }
      removed++
      return null
    })
    return result(text, t, `removed ${plural(removed, 'line')}`)
  },

  dedupeLines(text, op) {
    const seen = new Set<string>()
    let removed = 0
    const t = mapLines(text, (l) => {
      if (op.keepBlank && l.trim() === '') return l
      let key = op.ignoreWhitespace ? l.trim() : l
      if (op.caseInsensitive) key = key.toLowerCase()
      if (seen.has(key)) {
        removed++
        return null
      }
      seen.add(key)
      return l
    })
    return result(text, t, `removed ${plural(removed, 'duplicate')}`)
  },

  sortLines(text, op) {
    const cmp = makeLineComparator(op)
    let n = 0
    const t = reorderLines(text, (lines) => {
      n = lines.length
      const sorted = lines.slice().sort(cmp)
      return op.order === 'desc' ? sorted.reverse() : sorted
    })
    return result(text, t, `sorted ${plural(n, 'line')}`)
  },

  reverseLines(text) {
    let n = 0
    const t = reorderLines(text, (lines) => {
      n = lines.length
      return lines.slice().reverse()
    })
    return result(text, t, `reversed ${plural(n, 'line')}`)
  },

  reverseWords(text) {
    let n = 0
    const t = mapLines(text, (l) => {
      const lead = /^\s*/.exec(l)![0]
      const trail = /\s*$/.exec(l.slice(lead.length))![0]
      const core = l.slice(lead.length, l.length - trail.length)
      if (!core) return l
      const parts = core.split(/(\s+)/)
      const words = parts.filter((_, i) => i % 2 === 0).reverse()
      let out = ''
      for (let i = 0, w = 0; i < parts.length; i++) out += i % 2 === 0 ? words[w++] : parts[i]
      if (out !== core) n++
      return lead + out + trail
    })
    return result(text, t, `reversed words on ${plural(n, 'line')}`)
  },

  reverseText(text) {
    const t = reverseGraphemes(text)
    return result(text, t, `reversed ${plural(graphemes(text).length, 'character')}`)
  },

  addLineNumbers(text, op) {
    const { lines } = splitLines(text)
    const total = op.skipBlank ? lines.filter((l) => l.trim() !== '').length : lines.length
    const width = String(Math.max(op.start, op.start + total - 1)).length
    let n = op.start
    let numbered = 0
    const t = mapLines(text, (l) => {
      if (op.skipBlank && l.trim() === '') return l
      const s = String(n++)
      numbered++
      const padded = op.pad === 'zero' ? s.padStart(width, '0') : op.pad === 'space' ? s.padStart(width, ' ') : s
      return padded + op.separator + l
    })
    return result(text, t, `numbered ${plural(numbered, 'line')}`)
  },

  removeLineNumbers(text) {
    const { lines } = splitLines(text)
    const nonBlank = lines.filter((l) => l.trim() !== '')
    const loose = nonBlank.length > 0 && nonBlank.every((l) => RE_LINE_NUMBER_STRICT.test(l) || RE_LINE_NUMBER_LOOSE.test(l))
    let n = 0
    const t = mapLines(text, (l) => {
      const m = RE_LINE_NUMBER_STRICT.exec(l) ?? (loose ? RE_LINE_NUMBER_LOOSE.exec(l) : null)
      if (!m) return l
      n++
      return l.slice(m[0].length)
    })
    return result(text, t, `removed numbers from ${plural(n, 'line')}`)
  },

  prefixSuffix(text, op) {
    let n = 0
    const t = mapLines(text, (l) => {
      if (op.skipBlank && l.trim() === '') return l
      n++
      return op.prefix + l + op.suffix
    })
    return result(text, t, `changed ${plural(n, 'line')}`)
  },

  tabsToSpaces(text, op) {
    const size = Math.max(1, Math.min(16, Math.floor(op.size) || 1))
    let tabs = 0
    const t = mapLines(text, (l) => {
      if (!l.includes('\t')) return l
      if (!op.tabStops) {
        return l.replace(/\t/g, () => {
          tabs++
          return ' '.repeat(size)
        })
      }
      let out = ''
      let col = 0
      for (const ch of l) {
        if (ch === '\t') {
          tabs++
          const pad = size - (col % size)
          out += ' '.repeat(pad)
          col += pad
        } else {
          out += ch
          col++
        }
      }
      return out
    })
    return result(text, t, `replaced ${plural(tabs, 'tab')}`)
  },

  spacesToTabs(text, op) {
    const size = Math.max(1, Math.min(16, Math.floor(op.size) || 1))
    let tabs = 0
    const group = ' '.repeat(size)
    const t = mapLines(text, (l) => {
      if (op.scope === 'leading') {
        const indent = /^[ \t]*/.exec(l)![0]
        if (!indent.includes(group)) return l
        // Measure indentation width, then rebuild it from tabs (+ remaining spaces).
        let width = 0
        for (const ch of indent) width = ch === '\t' ? width + size - (width % size) : width + 1
        const nTabs = Math.floor(width / size)
        tabs += nTabs
        return '\t'.repeat(nTabs) + ' '.repeat(width % size) + l.slice(indent.length)
      }
      return l.replace(new RegExp(` {${size}}`, 'g'), () => {
        tabs++
        return '\t'
      })
    })
    return result(text, t, `inserted ${plural(tabs, 'tab')}`)
  },

  lineEndings(text, op) {
    const target = op.eol === 'crlf' ? '\r\n' : op.eol === 'cr' ? '\r' : '\n'
    const c = countEols(text)
    const converted = op.eol === 'lf' ? c.crlf + c.cr : op.eol === 'crlf' ? c.lf + c.cr : c.lf + c.crlf
    const t = text.replace(/\r\n|\r|\n/g, target)
    return result(text, t, `converted ${plural(converted, 'line ending')} to ${op.eol.toUpperCase()}`)
  },

  stripHtml(text, op) {
    const r = stripHtml(text, { decodeEntities: op.decodeEntities, blockNewlines: op.blockNewlines })
    return result(text, r.text, `removed ${plural(r.tags, 'tag')}${r.entities ? `, decoded ${plural(r.entities, 'entity', 'entities')}` : ''}`)
  },

  removeSpecial(text, op) {
    const extra = Array.from(op.extra ?? '')
      .map((c) => c.replace(/[\\\]^-]/g, '\\$&'))
      .join('')
    const punct = op.keepPunctuation ? `.,;:!?'"()\\-` : ''
    const re = new RegExp(`[^\\p{L}\\p{M}\\p{N}\\s${punct}${extra}]`, 'gu')
    let n = 0
    const t = text.replace(re, () => {
      n++
      return ''
    })
    return result(text, t, `removed ${plural(n, 'character')}`)
  },

  removeNumbers(text) {
    let n = 0
    const t = text.replace(/\p{Nd}+(?:[.,]\p{Nd}+)*/gu, () => {
      n++
      return ''
    })
    return result(text, t, `removed ${plural(n, 'number')}`)
  },

  removePunctuation(text, op) {
    const re = op.symbols ? /[\p{P}\p{S}]/gu : /\p{P}/gu
    let n = 0
    const t = text.replace(re, (ch, offset: number, s: string) => {
      if (op.keepApostrophes && (ch === "'" || ch === '’') && /[\p{L}\p{N}]/u.test(s[offset - 1] ?? '') && /[\p{L}\p{N}]/u.test(s[offset + 1] ?? '')) return ch
      n++
      return ''
    })
    return result(text, t, `removed ${plural(n, 'character')}`)
  },

  normalizeUnicode(text, op) {
    const t = text.normalize(op.form)
    const diff = t.length - text.length
    return result(text, t, `normalized to ${op.form}${diff ? ` (${diff > 0 ? '+' : ''}${fmt.format(diff)} code units)` : ''}`)
  },

  extract(text, op) {
    const items = extractItems(text, op.what)
    const found = items.length
    let out = items
    if (op.dedupe) {
      const seen = new Set<string>()
      const caseless = op.what === 'emails' || op.what === 'hashtags' || op.what === 'mentions'
      out = items.filter((it) => {
        const k = caseless ? it.toLowerCase() : it
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    }
    const noun = EXTRACT_LABELS[op.what].noun
    const dupes = found - out.length
    const t = out.join('\n')
    return { text: t, changed: t !== text, summary: `extracted ${fmt.format(out.length)} ${out.length === 1 ? noun[0] : noun[1]}${dupes ? ` (${fmt.format(dupes)} duplicate${dupes === 1 ? '' : 's'} dropped)` : ''}` }
  },
}

export function applyOp(text: string, op: CleanerOp): StepResult {
  return (impls[op.kind] as Impl<OpKind>)(text, op as never)
}

// ── Pipeline ─────────────────────────────────────────────────────────────────────

export interface PipelineStep {
  id: string
  enabled: boolean
  op: CleanerOp
}

export interface StepReport {
  id: string
  summary: string
  changed: boolean
  skipped: boolean
  /** Character count after this step. */
  length: number
  ms: number
}

export interface PipelineResult {
  output: string
  steps: StepReport[]
}

export function runPipeline(text: string, steps: PipelineStep[]): PipelineResult {
  let cur = text
  const reports: StepReport[] = []
  for (const s of steps) {
    if (!s.enabled) {
      reports.push({ id: s.id, summary: 'disabled', changed: false, skipped: true, length: cur.length, ms: 0 })
      continue
    }
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const r = applyOp(cur, s.op)
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    cur = r.text
    reports.push({ id: s.id, summary: r.summary, changed: r.changed, skipped: false, length: cur.length, ms })
  }
  return { output: cur, steps: reports }
}

// ── Presets ──────────────────────────────────────────────────────────────────────

export interface CleanerPreset {
  id: string
  label: string
  description: string
  ops: CleanerOp[]
}

export const PRESETS: CleanerPreset[] = [
  {
    id: 'pasted-list',
    label: 'Clean pasted list',
    description: 'Trim lines, drop blanks and duplicates',
    ops: [
      { kind: 'trimLines', side: 'both' },
      { kind: 'collapseSpaces', includeTabs: true, keepIndent: false },
      { kind: 'removeBlankLines', mode: 'all', whitespaceIsBlank: true },
      { kind: 'dedupeLines', caseInsensitive: false, ignoreWhitespace: true, keepBlank: false },
    ],
  },
  {
    id: 'whitespace',
    label: 'Normalize whitespace',
    description: 'Spaces, trailing whitespace, blank runs, LF endings',
    ops: [
      { kind: 'lineEndings', eol: 'lf' },
      { kind: 'tabsToSpaces', size: 4, tabStops: true },
      { kind: 'trimLines', side: 'end' },
      { kind: 'collapseSpaces', includeTabs: true, keepIndent: true },
      { kind: 'removeBlankLines', mode: 'collapse', whitespaceIsBlank: true },
      { kind: 'trim' },
    ],
  },
  {
    id: 'sort-unique',
    label: 'Sort & dedupe lines',
    description: 'Unique lines in natural order',
    ops: [
      { kind: 'trimLines', side: 'both' },
      { kind: 'removeBlankLines', mode: 'all', whitespaceIsBlank: true },
      { kind: 'dedupeLines', caseInsensitive: true, ignoreWhitespace: true, keepBlank: false },
      { kind: 'sortLines', order: 'asc', natural: true, locale: true, caseInsensitive: true },
    ],
  },
  {
    id: 'html-to-text',
    label: 'HTML to plain text',
    description: 'Strip tags, decode entities, tidy blank lines',
    ops: [
      { kind: 'stripHtml', decodeEntities: true, blockNewlines: true },
      { kind: 'trimLines', side: 'both' },
      { kind: 'collapseSpaces', includeTabs: true, keepIndent: false },
      { kind: 'removeBlankLines', mode: 'collapse', whitespaceIsBlank: true },
      { kind: 'trim' },
    ],
  },
  {
    id: 'emails',
    label: 'Extract emails',
    description: 'Unique email addresses, sorted',
    ops: [
      { kind: 'extract', what: 'emails', dedupe: true },
      { kind: 'sortLines', order: 'asc', natural: false, locale: true, caseInsensitive: true },
    ],
  },
  {
    id: 'urls',
    label: 'Extract URLs',
    description: 'Unique links in order of appearance',
    ops: [{ kind: 'extract', what: 'urls', dedupe: true }],
  },
  {
    id: 'ascii-ish',
    label: 'Simplify characters',
    description: 'NFKC, drop symbols and emoji, collapse spaces',
    ops: [
      { kind: 'normalizeUnicode', form: 'NFKC' },
      { kind: 'removeSpecial', keepPunctuation: true, extra: '' },
      { kind: 'collapseSpaces', includeTabs: true, keepIndent: true },
      { kind: 'trimLines', side: 'end' },
    ],
  },
]
