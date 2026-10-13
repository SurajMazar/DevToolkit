/**
 * Duplicate line analysis: groups equal lines (with optional case/whitespace folding),
 * records where each occurs, and builds the derived outputs (unique, duplicated, singletons).
 */
import { reorderLines, splitLines } from './lines'

export interface DuplicateOptions {
  caseInsensitive: boolean
  /** Compare lines with leading/trailing whitespace removed. */
  trim: boolean
  /** Blank (empty or whitespace-only) lines are never reported as duplicates. */
  ignoreBlank: boolean
}

export const DEFAULT_DUPLICATE_OPTIONS: DuplicateOptions = { caseInsensitive: false, trim: true, ignoreBlank: true }

export interface DuplicateGroup {
  /** The first occurrence, as written. */
  text: string
  count: number
  /** 1-based line numbers of every occurrence, ascending. */
  lines: number[]
  /** True when occurrences differ in case or surrounding whitespace (folded together by the options). */
  variants: boolean
}

export interface DuplicateReport {
  totalLines: number
  blankLines: number
  /** Distinct (folded) non-ignored lines. */
  distinct: number
  /** Lines that occur more than once, ordered by count desc, then first occurrence. */
  groups: DuplicateGroup[]
  /** Occurrences beyond the first, summed over all groups (lines removed by dedupe). */
  redundant: number
  /** Distinct lines that occur exactly once. */
  singles: number
}

function keyOf(line: string, o: DuplicateOptions) {
  let k = o.trim ? line.trim() : line
  if (o.caseInsensitive) k = k.toLowerCase()
  return k
}

export function findDuplicates(text: string, opts: Partial<DuplicateOptions> = {}): DuplicateReport {
  const o = { ...DEFAULT_DUPLICATE_OPTIONS, ...opts }
  const { lines } = splitLines(text)
  const map = new Map<string, { first: number; lines: number[]; variants: boolean }>()
  let blankLines = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const blank = line.trim() === ''
    if (blank) blankLines++
    if (blank && o.ignoreBlank) continue
    const k = keyOf(line, o)
    const e = map.get(k)
    if (e) {
      e.lines.push(i + 1)
      if (!e.variants && line !== lines[e.first]) e.variants = true
    } else map.set(k, { first: i, lines: [i + 1], variants: false })
  }
  const groups: DuplicateGroup[] = []
  let redundant = 0
  let singles = 0
  for (const e of map.values()) {
    if (e.lines.length > 1) {
      groups.push({ text: lines[e.first], count: e.lines.length, lines: e.lines, variants: e.variants })
      redundant += e.lines.length - 1
    } else singles++
  }
  groups.sort((a, b) => b.count - a.count || a.lines[0] - b.lines[0])
  return { totalLines: lines.length, blankLines, distinct: map.size, groups, redundant, singles }
}

export type DuplicateOutput = 'unique' | 'duplicated' | 'singles' | 'duplicated-all'

export const OUTPUT_LABELS: Record<DuplicateOutput, { label: string; description: string }> = {
  unique: { label: 'Unique lines', description: 'Every line once — first occurrence kept, original order' },
  duplicated: { label: 'Duplicated lines', description: 'Only lines that occur more than once, each listed once' },
  'duplicated-all': { label: 'All duplicate occurrences', description: 'Every occurrence of every repeated line, in original order' },
  singles: { label: 'Lines that appear once', description: 'Only lines with no duplicates' },
}

/** Builds one of the derived outputs. Line endings follow the input's dominant terminator. */
export function buildDuplicateOutput(text: string, kind: DuplicateOutput, opts: Partial<DuplicateOptions> = {}): string {
  const o = { ...DEFAULT_DUPLICATE_OPTIONS, ...opts }
  return reorderLines(text, (lines) => {
    const counts = new Map<string, number>()
    for (const l of lines) {
      if (o.ignoreBlank && l.trim() === '') continue
      const k = keyOf(l, o)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const seen = new Set<string>()
    const out: string[] = []
    for (const l of lines) {
      const blank = l.trim() === ''
      if (blank && o.ignoreBlank) {
        // Blank lines are structure, not data: keep them only in the "unique" view.
        if (kind === 'unique') out.push(l)
        continue
      }
      const k = keyOf(l, o)
      const c = counts.get(k)!
      if (kind === 'unique') {
        if (!seen.has(k)) out.push(l)
      } else if (kind === 'duplicated') {
        if (c > 1 && !seen.has(k)) out.push(l)
      } else if (kind === 'duplicated-all') {
        if (c > 1) out.push(l)
      } else if (c === 1) out.push(l)
      seen.add(k)
    }
    return out
  })
}
