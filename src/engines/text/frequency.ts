/**
 * Word and phrase (n-gram) frequency. Phrases never span a sentence end or a line break,
 * so "end. Start" and the last word of one list item + the first of the next are not counted.
 */
import { forEachWord, STOP_WORDS } from './stats'

export interface FrequencyOptions {
  /** 1 = words, 2 = bigrams, 3 = trigrams. */
  n: 1 | 2 | 3
  caseSensitive: boolean
  /** Drop stop words (unigrams) / phrases that start or end with a stop word (n-grams). */
  excludeStopWords: boolean
  /** Ignore terms containing a word shorter than this (in code points). */
  minLength: number
  /** Drop words that are purely numeric. */
  excludeNumbers: boolean
  /** Return at most this many rows (0 = all). */
  topN: number
}

export const DEFAULT_FREQUENCY_OPTIONS: FrequencyOptions = { n: 1, caseSensitive: false, excludeStopWords: true, minLength: 1, excludeNumbers: false, topN: 0 }

export interface FrequencyRow {
  rank: number
  term: string
  count: number
  /** Share of all n-grams in the text (before filtering), 0–1. */
  share: number
}

export interface FrequencyResult {
  rows: FrequencyRow[]
  /** Total words in the text. */
  words: number
  /** Total n-grams of the selected size (before filtering). */
  totalTerms: number
  /** Distinct terms after filtering. */
  uniqueTerms: number
  /** Occurrences that passed the filters. */
  countedTerms: number
  /** True when rows were cut to topN. */
  truncated: boolean
}

const RE_BREAK = /[.!?…;:]+(?=\s|$)|[。！？]|\r\n|\r|\n/u
const RE_NUMERIC = /^[\p{N}.,'’-]+$/u

function codePoints(s: string) {
  let n = 0
  for (const _ of s) n++
  return n
}

export function wordFrequency(text: string, opts: Partial<FrequencyOptions> = {}): FrequencyResult {
  const o = { ...DEFAULT_FREQUENCY_OPTIONS, ...opts }
  const n = o.n
  const counts = new Map<string, number>()
  let words = 0
  let totalTerms = 0
  let countedTerms = 0

  const keep = (w: string) => {
    if (o.minLength > 1 && codePoints(w) < o.minLength) return false
    if (o.excludeNumbers && RE_NUMERIC.test(w)) return false
    return true
  }
  const isStop = (w: string) => STOP_WORDS.has(w.toLowerCase())

  const segments = n === 1 ? [text] : text.split(RE_BREAK)
  const window: string[] = []
  for (const segment of segments) {
    if (!segment) continue
    window.length = 0
    forEachWord(segment, (raw) => {
      words++
      const w = o.caseSensitive ? raw : raw.toLowerCase()
      if (n === 1) {
        totalTerms++
        if (!keep(w) || (o.excludeStopWords && isStop(w))) return
        countedTerms++
        counts.set(w, (counts.get(w) ?? 0) + 1)
        return
      }
      window.push(w)
      if (window.length > n) window.shift()
      if (window.length < n) return
      totalTerms++
      if (!window.every(keep)) return
      if (o.excludeStopWords && (isStop(window[0]) || isStop(window[n - 1]))) return
      countedTerms++
      const key = window.join(' ')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const limit = o.topN > 0 ? Math.min(o.topN, sorted.length) : sorted.length
  const rows: FrequencyRow[] = new Array(limit)
  // Competition ranking: equal counts share a rank (1, 2, 2, 4).
  let rank = 0
  for (let i = 0; i < limit; i++) {
    const [term, count] = sorted[i]
    if (i === 0 || sorted[i - 1][1] !== count) rank = i + 1
    rows[i] = { rank, term, count, share: totalTerms ? count / totalTerms : 0 }
  }
  return { rows, words, totalTerms, uniqueTerms: counts.size, countedTerms, truncated: limit < sorted.length }
}

export type FrequencySortKey = 'rank' | 'term' | 'count'

export function sortRows(rows: FrequencyRow[], key: FrequencySortKey, dir: 'asc' | 'desc'): FrequencyRow[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const out = rows.slice()
  const sign = dir === 'asc' ? 1 : -1
  if (key === 'term') out.sort((a, b) => sign * collator.compare(a.term, b.term) || a.rank - b.rank)
  else if (key === 'count') out.sort((a, b) => sign * (a.count - b.count) || collator.compare(a.term, b.term))
  else out.sort((a, b) => sign * (a.rank - b.rank) || collator.compare(a.term, b.term))
  return out
}

function csvCell(s: string) {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV (RFC 4180) with a header row. */
export function frequencyToCsv(rows: FrequencyRow[], n: 1 | 2 | 3): string {
  const head = ['rank', n === 1 ? 'word' : 'phrase', 'count', 'percent']
  const lines = [head.join(',')]
  for (const r of rows) lines.push([r.rank, csvCell(r.term), r.count, (r.share * 100).toFixed(4)].join(','))
  return lines.join('\n') + '\n'
}

export function frequencyToJson(result: FrequencyResult, rows: FrequencyRow[], n: 1 | 2 | 3): string {
  return JSON.stringify(
    {
      ngram: n,
      totalWords: result.words,
      totalTerms: result.totalTerms,
      uniqueTerms: result.uniqueTerms,
      terms: rows.map((r) => ({ rank: r.rank, term: r.term, count: r.count, percent: Number((r.share * 100).toFixed(4)) })),
    },
    null,
    2,
  )
}

export function frequencyToTsv(rows: FrequencyRow[]): string {
  return rows.map((r) => `${r.term}\t${r.count}`).join('\n')
}
