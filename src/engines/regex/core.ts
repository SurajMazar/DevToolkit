/**
 * Regex execution primitives. These run inside a worker (see ./safe.ts) so that a
 * catastrophically backtracking pattern can be killed instead of freezing the page.
 */

export interface RegexGroup {
  /** 1-based group number. */
  index: number
  name?: string
  text: string | undefined
  start?: number
  end?: number
}

export interface RegexMatch {
  index: number
  end: number
  text: string
  groups: RegexGroup[]
}

export interface MatchResult {
  matches: RegexMatch[]
  /** Total matches found (may exceed matches.length when capped). */
  total: number
  /** True when matching stopped at the cap. */
  capped: boolean
  groupNames: string[]
}

export interface CompileResult {
  ok: boolean
  error?: string
  groupCount?: number
  groupNames?: string[]
}

/** Validates a pattern without running it (compilation is linear-time and safe). */
export function compileRegex(pattern: string, flags: string): CompileResult {
  try {
    const re = new RegExp(pattern, flags)
    const groupCount = new RegExp(`${re.source}|`, flags.replace(/[gy]/g, '')).exec('')!.length - 1
    const names = Array.from(pattern.matchAll(/\(\?<([A-Za-z_$][\w$]*)>/g), (m) => m[1])
    return { ok: true, groupCount, groupNames: names }
  } catch (e) {
    return { ok: false, error: (e as Error).message.replace(/^Invalid regular expression: /, '') }
  }
}

export function findMatches(pattern: string, flags: string, text: string, cap = 10_000): MatchResult {
  const withIndices = flags.includes('d') ? flags : flags + 'd'
  const global = withIndices.includes('g') || withIndices.includes('y') ? withIndices : withIndices + 'g'
  const re = new RegExp(pattern, global)
  const names = Array.from(pattern.matchAll(/\(\?<([A-Za-z_$][\w$]*)>/g), (m) => m[1])
  const matches: RegexMatch[] = []
  let total = 0
  let capped = false
  const onlyFirst = !flags.includes('g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    total++
    if (matches.length < cap) {
      const indices = (m as RegExpExecArray & { indices?: ([number, number] | undefined)[] }).indices
      const groupNameByIndex = new Map<number, string>()
      if (m.groups && indices) {
        const named = (m as unknown as { indices: { groups?: Record<string, [number, number] | undefined> } }).indices.groups ?? {}
        for (const [name, range] of Object.entries(named)) {
          for (let i = 1; i < m.length; i++) {
            const r = indices[i]
            if (r && range && r[0] === range[0] && r[1] === range[1] && !groupNameByIndex.has(i)) {
              groupNameByIndex.set(i, name)
              break
            }
          }
        }
      }
      const groups: RegexGroup[] = []
      for (let i = 1; i < m.length; i++) {
        const r = indices?.[i]
        groups.push({ index: i, name: groupNameByIndex.get(i), text: m[i], start: r?.[0], end: r?.[1] })
      }
      matches.push({ index: m.index, end: m.index + m[0].length, text: m[0], groups })
    } else {
      capped = true
      break
    }
    if (onlyFirst) break
    if (m[0] === '') re.lastIndex += re.unicode || re.unicodeSets ? codePointLength(text, re.lastIndex) : 1
  }
  return { matches, total, capped, groupNames: names }
}

function codePointLength(text: string, i: number) {
  const c = text.charCodeAt(i)
  return c >= 0xd800 && c <= 0xdbff ? 2 : 1
}

export interface ReplaceResult {
  output: string
  count: number
}

/** String.replace with JS replacement syntax ($1, $<name>, $&, $`, $'). */
export function replaceAll(pattern: string, flags: string, text: string, replacement: string): ReplaceResult {
  const re = new RegExp(pattern, flags)
  let count = 0
  const output = text.replace(re, (...args) => {
    count++
    // Rebuild the replacement with standard $-substitutions.
    const match = args[0] as string
    const hasNamed = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null
    const named = (hasNamed ? args[args.length - 1] : undefined) as Record<string, string> | undefined
    const offset = args[hasNamed ? args.length - 3 : args.length - 2] as number
    const str = args[hasNamed ? args.length - 2 : args.length - 1] as string
    const groups = args.slice(1, hasNamed ? args.length - 3 : args.length - 2) as (string | undefined)[]
    return expandReplacement(replacement, match, groups, offset, str, named)
  })
  return { output, count }
}

export function expandReplacement(rep: string, match: string, groups: (string | undefined)[], offset: number, str: string, named?: Record<string, string>): string {
  return rep.replace(/\$(\$|&|`|'|\d{1,2}|<([^>]*)>)/g, (tok, what: string, name?: string) => {
    if (what === '$') return '$'
    if (what === '&') return match
    if (what === '`') return str.slice(0, offset)
    if (what === "'") return str.slice(offset + match.length)
    if (name !== undefined) return named ? (named[name] ?? '') : tok
    const n = Number(what)
    if (n >= 1 && n <= groups.length) return groups[n - 1] ?? ''
    // "$12" with only one group means "$1" followed by "2".
    if (what.length === 2) {
      const n1 = Number(what[0])
      if (n1 >= 1 && n1 <= groups.length) return (groups[n1 - 1] ?? '') + what[1]
    }
    return tok
  })
}

/** Escapes a literal string for use inside a RegExp. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** Builds pattern/flags for plain-text or regex search with common options. */
export function buildSearch(query: string, opts: { regex: boolean; caseSensitive: boolean; wholeWord: boolean; multiline?: boolean; dotAll?: boolean; unicode?: boolean }) {
  let pattern = opts.regex ? query : escapeRegex(query)
  if (opts.wholeWord) pattern = `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`
  let flags = 'g'
  if (!opts.caseSensitive) flags += 'i'
  if (opts.multiline) flags += 'm'
  if (opts.dotAll) flags += 's'
  if (opts.unicode !== false || opts.wholeWord) flags += 'u'
  return { pattern, flags }
}
