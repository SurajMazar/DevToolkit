/**
 * Text statistics. Word segmentation uses Intl.Segmenter (handles CJK, Thai and
 * other scripts without spaces) when available, falling back to a Unicode regex.
 */

const RE_WORD = /[\p{L}\p{M}\p{N}]+(?:['’.\-][\p{L}\p{M}\p{N}]+)*/gu

let wordSegmenter: Intl.Segmenter | null | undefined
function seg(): Intl.Segmenter | null {
  if (wordSegmenter === undefined) wordSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null
  return wordSegmenter
}

const RE_NEEDS_SEGMENTER = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u

/** Iterates words; uses the segmenter only when the text contains space-less scripts. */
export function forEachWord(text: string, fn: (word: string) => void) {
  const s = RE_NEEDS_SEGMENTER.test(text) ? seg() : null
  if (s) {
    for (const part of s.segment(text)) if (part.isWordLike) fn(part.segment)
    return
  }
  for (const m of text.matchAll(RE_WORD)) fn(m[0])
}

export function countWords(text: string): number {
  if (!text) return 0
  if (!RE_NEEDS_SEGMENTER.test(text)) {
    let n = 0
    RE_WORD.lastIndex = 0
    while (RE_WORD.exec(text)) n++
    return n
  }
  let n = 0
  forEachWord(text, () => n++)
  return n
}

export interface TextStats {
  characters: number
  /** User-perceived characters (grapheme clusters), e.g. 👨‍👩‍👧 counts as 1. */
  graphemes: number
  charactersNoSpaces: number
  letters: number
  digits: number
  words: number
  uniqueWords: number
  lines: number
  nonEmptyLines: number
  sentences: number
  paragraphs: number
  bytesUtf8: number
  avgWordLength: number
  avgSentenceWords: number
  readingSeconds: number
  speakingSeconds: number
  longestLine: { number: number; length: number; text: string }
  longestWord: string
  topWords: { word: string; count: number }[]
}

export interface StatsOptions {
  /** Words per minute used for reading-time estimates (silent reading ≈ 238). */
  readingWpm?: number
  /** Words per minute for speaking-time estimates (presentation pace ≈ 140). */
  speakingWpm?: number
  topN?: number
  excludeStopWords?: boolean
  caseSensitive?: boolean
}

export const STOP_WORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves`.split(' '),
)

export function computeStats(text: string, opts: StatsOptions = {}): TextStats {
  const readingWpm = opts.readingWpm ?? 238
  const speakingWpm = opts.speakingWpm ?? 140
  const topN = opts.topN ?? 20

  let charactersNoSpaces = 0
  let letters = 0
  let digits = 0
  for (const ch of text) {
    if (!/\s/u.test(ch)) charactersNoSpaces++
    if (/\p{L}/u.test(ch)) letters++
    else if (/\p{N}/u.test(ch)) digits++
  }

  let graphemes = 0
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl && text.length < 5_000_000) {
    const g = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const _ of g.segment(text)) graphemes++
  } else graphemes = Array.from(text).length

  const freq = new Map<string, number>()
  let words = 0
  let wordChars = 0
  let longestWord = ''
  forEachWord(text, (w) => {
    words++
    wordChars += w.length
    if (w.length > longestWord.length) longestWord = w
    const key = opts.caseSensitive ? w : w.toLowerCase()
    freq.set(key, (freq.get(key) ?? 0) + 1)
  })

  const lines = text === '' ? 0 : text.split('\n')
  let longestLine = { number: 0, length: 0, text: '' }
  let nonEmptyLines = 0
  if (lines) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].replace(/\r$/, '')
      if (l.trim()) nonEmptyLines++
      if (l.length > longestLine.length) longestLine = { number: i + 1, length: l.length, text: l.length > 400 ? l.slice(0, 400) + '…' : l }
    }
  }

  // Sentences: terminal punctuation followed by whitespace/end, or a non-empty trailing fragment.
  const sentenceMatches = text.match(/[^.!?…。！？\n]*[\p{L}\p{N}][^.!?…。！？\n]*(?:[.!?…。！？]+|\n|$)/gu) ?? []
  const sentences = sentenceMatches.filter((s) => /[\p{L}\p{N}]/u.test(s)).length
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length

  const ranked = Array.from(freq.entries())
    .filter(([w]) => !opts.excludeStopWords || !STOP_WORDS.has(w.toLowerCase()))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }))

  return {
    characters: text.length,
    graphemes,
    charactersNoSpaces,
    letters,
    digits,
    words,
    uniqueWords: freq.size,
    lines: lines ? lines.length : 0,
    nonEmptyLines,
    sentences,
    paragraphs,
    bytesUtf8: new TextEncoder().encode(text).length,
    avgWordLength: words ? wordChars / words : 0,
    avgSentenceWords: sentences ? words / sentences : 0,
    readingSeconds: (words / readingWpm) * 60,
    speakingSeconds: (words / speakingWpm) * 60,
    longestLine,
    longestWord,
    topWords: ranked,
  }
}
