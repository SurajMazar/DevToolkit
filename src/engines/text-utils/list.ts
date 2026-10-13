/**
 * List conversion: lines ⇄ delimited lists with quote-aware splitting, quoting with
 * proper escaping, cleanup (trim / empties / dedupe / sort) and wrapping.
 */

export type Direction = 'join' | 'split'
export type QuoteStyle = 'none' | 'single' | 'double' | 'backtick' | 'csv'
export type EscapeStyle = 'backslash' | 'double'
export type WrapStyle = 'none' | 'brackets' | 'parens' | 'braces'
export type SortOrder = 'none' | 'asc' | 'desc' | 'natural' | 'length'

export interface ListOptions {
  /** Delimiter used for joining (and for splitting when not auto-detected). */
  delimiter: string
  /** When splitting, detect the delimiter instead of using `delimiter`. */
  autoDelimiter: boolean
  quote: QuoteStyle
  escape: EscapeStyle
  /** Leave items that look like numbers unquoted (SQL IN (1, 2), JSON numbers). */
  bareNumbers: boolean
  trim: boolean
  removeEmpty: boolean
  dedupe: boolean
  dedupeIgnoreCase: boolean
  sort: SortOrder
  wrap: WrapStyle
  /** When splitting: quote-aware parsing ("a, b", c → 2 items). */
  quoteAware: boolean
  /** When splitting: re-quote items in the output lines too. */
  quoteLines: boolean
}

export const DEFAULT_LIST_OPTIONS: ListOptions = {
  delimiter: ', ',
  autoDelimiter: true,
  quote: 'none',
  escape: 'backslash',
  bareNumbers: false,
  trim: true,
  removeEmpty: true,
  dedupe: false,
  dedupeIgnoreCase: false,
  sort: 'none',
  wrap: 'none',
  quoteAware: true,
  quoteLines: false,
}

export interface ListPreset {
  id: string
  label: string
  description: string
  options: Partial<ListOptions>
}

export const LIST_PRESETS: ListPreset[] = [
  {
    id: 'sql-in',
    label: 'SQL IN clause',
    description: "('a', 'b', 3) — single quotes doubled",
    options: { delimiter: ', ', quote: 'single', escape: 'double', bareNumbers: true, wrap: 'parens', trim: true, removeEmpty: true, dedupe: true },
  },
  {
    id: 'json-array',
    label: 'JSON array',
    description: '["a", "b"] — JSON string escaping',
    options: { delimiter: ', ', quote: 'double', escape: 'backslash', bareNumbers: false, wrap: 'brackets', trim: true, removeEmpty: true },
  },
  {
    id: 'csv-row',
    label: 'CSV row',
    description: 'a,"b, c" — quoted only when needed (RFC 4180)',
    options: { delimiter: ',', quote: 'csv', escape: 'double', bareNumbers: false, wrap: 'none', trim: true, removeEmpty: false },
  },
]

export const DELIMITERS: { value: string; label: string; char: string }[] = [
  { value: 'comma', label: 'Comma', char: ',' },
  { value: 'comma-space', label: 'Comma + space', char: ', ' },
  { value: 'semicolon', label: 'Semicolon', char: ';' },
  { value: 'pipe', label: 'Pipe', char: '|' },
  { value: 'tab', label: 'Tab', char: '\t' },
  { value: 'newline', label: 'Newline', char: '\n' },
  { value: 'space', label: 'Space', char: ' ' },
]

const QUOTE_CHAR: Record<Exclude<QuoteStyle, 'none' | 'csv'>, string> = { single: "'", double: '"', backtick: '`' }
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

// ── Splitting ──────────────────────────────────────────────────────────────────

export interface SplitResult {
  items: string[]
  delimiter: string
  /** Wrapper brackets that were removed: [ ], ( ), { }. */
  unwrapped: WrapStyle
  /** Parsed as a JSON array. */
  json: boolean
  /** Unterminated quote at this offset (items are still returned). */
  unterminatedQuote: number | null
}

/** Pick the most likely delimiter outside quotes. */
export function detectDelimiter(text: string): string {
  const candidates = ['\t', ';', '|', ',']
  const counts = new Map<string, number>(candidates.map((c) => [c, 0]))
  let q: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      // Only treat as a quote at the start of a field.
      const prev = text.slice(0, i).trimEnd().slice(-1)
      if (i === 0 || prev === '' || candidates.includes(prev) || prev === '[' || prev === '(' || prev === '{' || prev === '\n') q = c
      continue
    }
    if (counts.has(c)) counts.set(c, counts.get(c)! + 1)
  }
  let best = ','
  let bestN = 0
  for (const c of candidates) {
    const n = counts.get(c)!
    if (n > bestN) {
      best = c
      bestN = n
    }
  }
  if (bestN === 0) {
    if (/\n/.test(text.trim())) return '\n'
    if (/\s/.test(text.trim())) return ' '
    return ','
  }
  return best
}

function stripWrapper(text: string): { inner: string; wrap: WrapStyle } {
  const t = text.trim()
  const pairs: [string, string, WrapStyle][] = [
    ['[', ']', 'brackets'],
    ['(', ')', 'parens'],
    ['{', '}', 'braces'],
  ]
  for (const [a, b, w] of pairs) if (t.startsWith(a) && t.endsWith(b) && t.length >= 2) return { inner: t.slice(1, -1), wrap: w }
  return { inner: text, wrap: 'none' }
}

/**
 * Split a delimited string. Quote-aware: fields starting with ' " or ` may contain the
 * delimiter; inside them a doubled quote or a backslash escapes the quote character.
 */
export function splitDelimited(text: string, delimiter: string, quoteAware = true): { items: string[]; unterminatedQuote: number | null } {
  if (delimiter === '') return { items: [text], unterminatedQuote: null }
  const items: string[] = []
  let unterminatedQuote: number | null = null
  const isWs = delimiter === ' '
  let i = 0
  const n = text.length
  const atDelim = (k: number) => (delimiter === '\n' ? text[k] === '\n' || (text[k] === '\r' && text[k + 1] === '\n') : text.startsWith(delimiter, k))
  const delimLen = (k: number) => (delimiter === '\n' && text[k] === '\r' ? 2 : delimiter.length)
  while (i <= n) {
    // Skip leading spaces before a possible quote (but keep them for unquoted fields)
    let j = i
    while (j < n && (text[j] === ' ' || text[j] === '\t') && !atDelim(j)) j++
    const q = text[j]
    if (quoteAware && (q === '"' || q === "'" || q === '`')) {
      let k = j + 1
      let val = ''
      let closed = false
      while (k < n) {
        const c = text[k]
        if (c === '\\' && k + 1 < n && (text[k + 1] === q || text[k + 1] === '\\')) {
          val += text[k + 1]
          k += 2
          continue
        }
        if (c === q) {
          if (text[k + 1] === q) {
            val += q
            k += 2
            continue
          }
          closed = true
          k++
          break
        }
        val += c
        k++
      }
      if (closed) {
        // Skip to the next delimiter; anything between the closing quote and it is kept.
        let tail = ''
        while (k < n && !atDelim(k)) tail += text[k++]
        items.push(val + tail.trim())
        if (k >= n) break
        k += delimLen(k)
        if (isWs) while (k < n && text[k] === ' ') k++
        i = k
        if (i === n) {
          items.push('')
          break
        }
        continue
      }
      unterminatedQuote = j
      // Fall through: treat as an unquoted field.
    }
    let k = i
    let val = ''
    while (k < n && !atDelim(k)) val += text[k++]
    items.push(val)
    if (k >= n) break
    k += delimLen(k)
    if (isWs) while (k < n && text[k] === ' ') k++
    i = k
    if (i === n) {
      items.push('')
      break
    }
  }
  return { items, unterminatedQuote }
}

export function splitList(text: string, opts: Partial<ListOptions> = {}): SplitResult {
  const o = { ...DEFAULT_LIST_OPTIONS, ...opts }
  const trimmed = text.trim()
  // JSON array?
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const v: unknown = JSON.parse(trimmed)
      if (Array.isArray(v)) {
        return {
          items: v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))),
          delimiter: ',',
          unwrapped: 'brackets',
          json: true,
          unterminatedQuote: null,
        }
      }
    } catch {
      /* not JSON — parse as a delimited list */
    }
  }
  const { inner, wrap } = stripWrapper(text)
  const delimiter = o.autoDelimiter ? detectDelimiter(inner) : o.delimiter
  const { items, unterminatedQuote } = splitDelimited(inner, delimiter, o.quoteAware)
  return { items, delimiter, unwrapped: wrap, json: false, unterminatedQuote }
}

// ── Processing ─────────────────────────────────────────────────────────────────

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function processItems(items: string[], o: Pick<ListOptions, 'trim' | 'removeEmpty' | 'dedupe' | 'dedupeIgnoreCase' | 'sort'>): { items: string[]; removedEmpty: number; removedDuplicates: number } {
  let out = o.trim ? items.map((s) => s.trim()) : items.slice()
  let removedEmpty = 0
  let removedDuplicates = 0
  if (o.removeEmpty) {
    const before = out.length
    out = out.filter((s) => (o.trim ? s !== '' : s.trim() !== ''))
    removedEmpty = before - out.length
  }
  if (o.dedupe) {
    const seen = new Set<string>()
    const before = out.length
    out = out.filter((s) => {
      const k = o.dedupeIgnoreCase ? s.toLowerCase() : s
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    removedDuplicates = before - out.length
  }
  if (o.sort === 'asc') out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  else if (o.sort === 'desc') out.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  else if (o.sort === 'natural') out.sort(collator.compare)
  else if (o.sort === 'length') out.sort((a, b) => a.length - b.length || collator.compare(a, b))
  return { items: out, removedEmpty, removedDuplicates }
}

// ── Quoting & joining ──────────────────────────────────────────────────────────

export function quoteItem(item: string, quote: QuoteStyle, escape: EscapeStyle, delimiter = ','): string {
  if (quote === 'none') return item
  if (quote === 'csv') {
    const needs = item.includes('"') || item.includes('\n') || item.includes('\r') || (delimiter !== '' && item.includes(delimiter.trim() || delimiter)) || /^\s|\s$/.test(item)
    return needs ? `"${item.replace(/"/g, '""')}"` : item
  }
  const q = QUOTE_CHAR[quote]
  if (quote === 'double' && escape === 'backslash') return JSON.stringify(item)
  if (escape === 'double') return q + item.split(q).join(q + q) + q
  const body = item
    .replace(/\\/g, '\\\\')
    .split(q)
    .join('\\' + q)
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return q + body + q
}

const WRAPPERS: Record<WrapStyle, [string, string]> = { none: ['', ''], brackets: ['[', ']'], parens: ['(', ')'], braces: ['{', '}'] }

export function joinItems(items: string[], o: Pick<ListOptions, 'delimiter' | 'quote' | 'escape' | 'bareNumbers' | 'wrap'>): string {
  const parts = items.map((s) => (o.bareNumbers && NUMBER_RE.test(s) ? s : quoteItem(s, o.quote, o.escape, o.delimiter)))
  const [a, b] = WRAPPERS[o.wrap]
  return a + parts.join(o.delimiter) + b
}

// ── Direction detection & conversion ──────────────────────────────────────────

/**
 * Lines → list when the input has several lines and they don't look like one delimited
 * record; list → lines when the input is a single line (or a bracketed list) that
 * contains delimiters.
 */
export function detectDirection(text: string): Direction {
  const t = text.trim()
  if (!t) return 'join'
  if (/^\[[\s\S]*\]$/.test(t)) {
    try {
      if (Array.isArray(JSON.parse(t))) return 'split'
    } catch {
      /* fall through */
    }
  }
  const lines = t.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')
  if (lines.length <= 1) {
    const { inner } = stripWrapper(t)
    return /[,;|\t]/.test(inner) ? 'split' : 'join'
  }
  // Multi-line: if wrapped in brackets / parens with commas, it's a (pretty-printed) list.
  if (/^[[({][\s\S]*[\])}]$/.test(t) && /,/.test(t)) return 'split'
  return 'join'
}

export interface ConvertResult {
  output: string
  direction: Direction
  count: number
  delimiter: string
  removedEmpty: number
  removedDuplicates: number
  warning: string | null
}

export function convertList(text: string, direction: Direction | 'auto', opts: Partial<ListOptions> = {}): ConvertResult {
  const o = { ...DEFAULT_LIST_OPTIONS, ...opts }
  const dir = direction === 'auto' ? detectDirection(text) : direction
  if (dir === 'join') {
    const lines = text.split(/\r\n|\r|\n/)
    // A trailing newline should not create an empty last item.
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
    const p = processItems(lines, o)
    return { output: joinItems(p.items, o), direction: dir, count: p.items.length, delimiter: o.delimiter, removedEmpty: p.removedEmpty, removedDuplicates: p.removedDuplicates, warning: null }
  }
  // When splitting, the multi-line pretty-printed case is joined into one record first.
  const s = splitList(text.includes('\n') && /^\s*[[({]/.test(text) ? text.replace(/\r?\n\s*/g, ' ') : text, o)
  const p = processItems(s.items, o)
  const items = o.quoteLines ? p.items.map((it) => (o.bareNumbers && NUMBER_RE.test(it) ? it : quoteItem(it, o.quote, o.escape, o.delimiter))) : p.items
  const warning = s.unterminatedQuote != null ? `Unterminated quote at character ${s.unterminatedQuote + 1} — the rest of that field was split as plain text.` : null
  return { output: items.join('\n'), direction: dir, count: items.length, delimiter: s.delimiter, removedEmpty: p.removedEmpty, removedDuplicates: p.removedDuplicates, warning }
}

export function describeDelimiter(d: string): string {
  if (d === '\t') return 'tab'
  if (d === '\n') return 'newline'
  if (d === ' ') return 'space'
  return JSON.stringify(d)
}
