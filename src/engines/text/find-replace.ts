/**
 * Find & Replace helpers. Matching and replacing themselves are done by the shared regex
 * engine (`@/engines/regex/core`, executed through `SafeRegexRunner`); this module builds
 * the search, prepares the replacement string, and computes per-match previews.
 */
import { buildSearch, compileRegex, expandReplacement, type RegexMatch } from '@/engines/regex/core'

export interface FindOptions {
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  /** Regex only: ^ and $ match at line breaks. */
  multiline: boolean
  /** Regex only: . matches line breaks. */
  dotAll: boolean
  /** Regex only: Unicode mode (\p{…}, code-point aware). Always on for plain text. */
  unicode: boolean
}

export const DEFAULT_FIND_OPTIONS: FindOptions = { regex: false, caseSensitive: false, wholeWord: false, multiline: true, dotAll: false, unicode: true }

export interface BuiltSearch {
  pattern: string
  flags: string
}

export type SearchCheck = { ok: true; search: BuiltSearch; groupCount: number; groupNames: string[] } | { ok: false; error: string }

/** Builds and validates the search. Compilation is linear-time, so this is safe to call on every keystroke. */
export function prepareSearch(query: string, o: FindOptions): SearchCheck {
  const search = buildSearch(query, {
    regex: o.regex,
    caseSensitive: o.caseSensitive,
    wholeWord: o.wholeWord,
    multiline: o.regex && o.multiline,
    dotAll: o.regex && o.dotAll,
    unicode: o.regex ? o.unicode : true,
  })
  const c = compileRegex(search.pattern, search.flags)
  if (!c.ok) return { ok: false, error: c.error ?? 'Invalid pattern' }
  return { ok: true, search, groupCount: c.groupCount ?? 0, groupNames: c.groupNames ?? [] }
}

/**
 * Converts what the user typed in the Replace box into a JS replacement string.
 * - Plain mode: the text is literal, so `$` is escaped.
 * - Regex mode: `$1`, `$<name>`, `$&` work as in JavaScript; `\n`, `\t`, `\r` and `\\` are
 *   interpreted as escapes (like VS Code's regex replace).
 */
export function prepareReplacement(replacement: string, regex: boolean): string {
  if (!regex) return replacement.replace(/\$/g, '$$$$')
  return replacement.replace(/\\(n|t|r|\\)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : '\\'))
}

/**
 * Checks $-references in a regex replacement against the pattern's groups. Returns a warning
 * (JavaScript leaves unknown references as literal text, which is rarely what was meant).
 */
export function checkReplacement(replacement: string, groupCount: number, groupNames: string[]): string | null {
  for (const m of replacement.matchAll(/\$\$|\$(\d{1,2}|<([^>]*)>)/g)) {
    if (m[1] === undefined) continue // "$$"
    if (m[2] !== undefined) {
      if (groupNames.length === 0) return `$<${m[2]}> is inserted literally — the pattern has no named groups`
      if (!groupNames.includes(m[2])) return `$<${m[2]}> refers to a named group that does not exist (available: ${groupNames.join(', ')})`
      continue
    }
    const n = Number(m[1])
    const first = Number(m[1][0])
    if (n === 0 || first === 0 || n <= groupCount) continue
    if (m[1].length === 2 && first <= groupCount) continue // "$12" with one group = "$1" + "2"
    return `$${m[1]} is inserted literally — the pattern has ${groupCount === 0 ? 'no capture groups' : `only ${groupCount} capture group${groupCount === 1 ? '' : 's'}`}`
  }
  return null
}

export interface MatchPreview {
  index: number
  end: number
  before: string
  after: string
  line: number
  column: number
}

/** Expands the replacement for one match, with its 1-based line/column (lineStarts from buildLineIndex). */
export function previewMatch(text: string, lineStarts: number[], m: RegexMatch, replacement: string): MatchPreview {
  const groups = m.groups.map((g) => g.text)
  const named: Record<string, string> | undefined = m.groups.some((g) => g.name)
    ? Object.fromEntries(m.groups.filter((g) => g.name).map((g) => [g.name!, g.text ?? '']))
    : undefined
  const after = expandReplacement(replacement, m.text, groups, m.index, text, named)
  const { line, column } = positionAt(lineStarts, m.index)
  return { index: m.index, end: m.end, before: m.text, after, line, column }
}

/** Expands the replacement for each match (for the before → after list). */
export function previewReplacements(text: string, matches: RegexMatch[], replacement: string, limit = 2000): MatchPreview[] {
  const lineStarts = buildLineIndex(text)
  const out: MatchPreview[] = []
  for (let i = 0; i < matches.length && i < limit; i++) out.push(previewMatch(text, lineStarts, matches[i], replacement))
  return out
}

/** Offsets of the start of each line (handles LF, CRLF and CR). */
export function buildLineIndex(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 10) starts.push(i + 1)
    else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++
      starts.push(i + 1)
    }
  }
  return starts
}

/** 1-based line/column of an offset, via binary search over a line index. */
export function positionAt(lineStarts: number[], offset: number): { line: number; column: number } {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: offset - lineStarts[lo] + 1 }
}

/** Index of the match at or after `offset` (wrapping to 0). */
export function matchIndexAtOrAfter(matches: { index: number }[], offset: number): number {
  if (matches.length === 0) return -1
  let lo = 0
  let hi = matches.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (matches[mid].index < offset) lo = mid + 1
    else hi = mid
  }
  return lo >= matches.length ? 0 : lo
}

/** Describes the flags for display, e.g. "gimsu". */
export function describeFlags(flags: string) {
  return flags.split('').sort().join('')
}

/** Makes invisible characters in a match preview visible (newlines, tabs). */
export function visualize(s: string, max = 120): string {
  const v = s.replace(/\r\n/g, '↵').replace(/[\n\r]/g, '↵').replace(/\t/g, '→')
  return v.length > max ? v.slice(0, max) + '…' : v
}
