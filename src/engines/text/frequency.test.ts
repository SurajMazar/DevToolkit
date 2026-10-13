import { describe, expect, it } from 'vitest'
import { frequencyToCsv, frequencyToJson, frequencyToTsv, sortRows, wordFrequency } from './frequency'

const TEXT = `The cache is warm. The cache is cold!
Warm cache, warm cache — the CACHE wins.
Version 2 and version 10 of the cache.`

describe('wordFrequency', () => {
  it('counts unigrams case-insensitively with stop words removed', () => {
    const r = wordFrequency(TEXT, { n: 1 })
    expect(r.rows[0]).toMatchObject({ rank: 1, term: 'cache', count: 6 })
    expect(r.rows.find((x) => x.term === 'the')).toBeUndefined()
    expect(r.rows.find((x) => x.term === 'warm')!.count).toBe(3)
    expect(r.words).toBe(23)
    expect(r.totalTerms).toBe(23)
    expect(r.rows[0].share).toBeCloseTo(6 / 23)
  })
  it('case-sensitive keeps variants apart', () => {
    const r = wordFrequency(TEXT, { n: 1, caseSensitive: true, excludeStopWords: false })
    expect(r.rows.find((x) => x.term === 'CACHE')!.count).toBe(1)
    expect(r.rows.find((x) => x.term === 'The')!.count).toBe(2)
  })
  it('stop words can be kept', () => {
    const r = wordFrequency(TEXT, { n: 1, excludeStopWords: false })
    expect(r.rows.find((x) => x.term === 'the')!.count).toBe(4)
  })
  it('min length and number filtering', () => {
    const r = wordFrequency(TEXT, { n: 1, minLength: 5, excludeStopWords: false })
    expect(r.rows.every((x) => [...x.term].length >= 5)).toBe(true)
    const nums = wordFrequency(TEXT, { n: 1 })
    expect(nums.rows.some((x) => x.term === '10')).toBe(true)
    expect(wordFrequency(TEXT, { n: 1, excludeNumbers: true }).rows.some((x) => x.term === '10')).toBe(false)
  })
  it('bigrams do not cross sentence or line boundaries', () => {
    const r = wordFrequency(TEXT, { n: 2, excludeStopWords: false })
    expect(r.rows.find((x) => x.term === 'warm cache')!.count).toBe(2)
    expect(r.rows.find((x) => x.term === 'warm the')).toBeUndefined()
    expect(r.rows.find((x) => x.term === 'cold warm')).toBeUndefined()
    expect(r.rows.find((x) => x.term === 'the cache')!.count).toBe(4)
  })
  it('n-gram stop-word filter drops phrases starting or ending with a stop word', () => {
    const r = wordFrequency(TEXT, { n: 2, excludeStopWords: true })
    expect(r.rows.find((x) => x.term === 'the cache')).toBeUndefined()
    expect(r.rows.find((x) => x.term === 'warm cache')!.count).toBe(2)
    const t = wordFrequency('state of the art. state of the art', { n: 3, excludeStopWords: true })
    expect(t.rows).toEqual([])
    const t2 = wordFrequency('end of line. end of line', { n: 3, excludeStopWords: true })
    expect(t2.rows[0]).toMatchObject({ term: 'end of line', count: 2 })
  })
  it('keeps dotted tokens like node.js and 3.14 as single words', () => {
    const r = wordFrequency('node.js and node.js. pi is 3.14', { n: 1, excludeStopWords: false })
    expect(r.rows.find((x) => x.term === 'node.js')!.count).toBe(2)
    expect(r.rows.find((x) => x.term === '3.14')!.count).toBe(1)
  })
  it('competition ranking and topN', () => {
    const r = wordFrequency('a a b b c d', { n: 1, excludeStopWords: false, topN: 3 })
    expect(r.rows.map((x) => [x.rank, x.term])).toEqual([[1, 'a'], [1, 'b'], [3, 'c']])
    expect(r.truncated).toBe(true)
    expect(r.uniqueTerms).toBe(4)
  })
  it('handles empty input, emoji and CJK', () => {
    expect(wordFrequency('', { n: 2 })).toMatchObject({ rows: [], words: 0, totalTerms: 0 })
    const r = wordFrequency('東京は大きい。東京へ行く 👍 café café', { n: 1, excludeStopWords: false })
    expect(r.rows.find((x) => x.term === '東京')!.count).toBe(2)
    expect(r.rows.find((x) => x.term === 'café')!.count).toBe(2)
    expect(r.rows.some((x) => x.term.includes('👍'))).toBe(false)
  })
  it('CRLF breaks n-grams', () => {
    const r = wordFrequency('alpha beta\r\ngamma delta', { n: 2, excludeStopWords: false })
    expect(r.rows.map((x) => x.term).sort()).toEqual(['alpha beta', 'gamma delta'])
  })
  it('large input', () => {
    const big = 'lorem ipsum dolor sit amet consectetur. '.repeat(40_000)
    const t0 = performance.now()
    const r = wordFrequency(big, { n: 3, excludeStopWords: false })
    expect(r.rows[0].count).toBe(40_000)
    expect(performance.now() - t0).toBeLessThan(4000)
  })
})

describe('sorting and export', () => {
  const r = wordFrequency('b b a c c c, "quoted"', { n: 1, excludeStopWords: false })
  it('sorts by term, count and rank', () => {
    expect(sortRows(r.rows, 'term', 'asc').map((x) => x.term)).toEqual(['a', 'b', 'c', 'quoted'])
    expect(sortRows(r.rows, 'count', 'asc')[0].count).toBe(1)
    expect(sortRows(r.rows, 'rank', 'desc')[0].rank).toBe(3)
  })
  it('CSV, JSON and TSV', () => {
    const csv = frequencyToCsv(r.rows, 1)
    expect(csv.split('\n')[0]).toBe('rank,word,count,percent')
    expect(csv.split('\n')[1]).toBe('1,c,3,42.8571')
    expect(frequencyToCsv([{ rank: 1, term: 'a,"b"', count: 1, share: 1 }], 2)).toBe('rank,phrase,count,percent\n1,"a,""b""",1,100.0000\n')
    const json = JSON.parse(frequencyToJson(r, r.rows, 1))
    expect(json.terms[0]).toEqual({ rank: 1, term: 'c', count: 3, percent: 42.8571 })
    expect(frequencyToTsv(r.rows.slice(0, 1))).toBe('c\t3')
  })
})
