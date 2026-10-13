import { describe, expect, it } from 'vitest'
import { computeStats, countWords, forEachWord, STOP_WORDS } from './stats'

describe('countWords / forEachWord', () => {
  it('counts words with apostrophes, hyphens and dots inside', () => {
    expect(countWords("Don't stop-believing, node.js v2.0!")).toBe(3 + 1)
    expect(countWords('')).toBe(0)
    expect(countWords('   \n\t')).toBe(0)
  })
  it('segments CJK text without spaces', () => {
    const words: string[] = []
    forEachWord('東京は大きい', (w) => words.push(w))
    expect(words.length).toBeGreaterThan(1)
    expect(words.join('')).toBe('東京は大きい')
  })
  it('stop words are lowercase English', () => {
    expect(STOP_WORDS.has('the')).toBe(true)
    expect(STOP_WORDS.has('cache')).toBe(false)
  })
})

describe('computeStats', () => {
  const text = 'Hello world. This is a test!\n\nSecond paragraph here 42 times.\nA much longer line than the others in this text.'
  const s = computeStats(text)
  it('character counts', () => {
    expect(s.characters).toBe(text.length)
    expect(s.charactersNoSpaces).toBe(text.replace(/\s/g, '').length)
    expect(s.digits).toBe(2)
    expect(s.bytesUtf8).toBe(text.length)
  })
  it('structure', () => {
    expect(s.lines).toBe(4)
    expect(s.nonEmptyLines).toBe(3)
    expect(s.paragraphs).toBe(2)
    expect(s.sentences).toBe(4)
    expect(s.longestLine.number).toBe(4)
    expect(s.longestLine.length).toBe('A much longer line than the others in this text.'.length)
    expect(s.longestWord).toBe('paragraph')
  })
  it('words and averages', () => {
    expect(s.words).toBe(21)
    expect(s.avgSentenceWords).toBeCloseTo(21 / 4)
    expect(s.readingSeconds).toBeCloseTo((21 / 238) * 60)
    expect(computeStats(text, { readingWpm: 60, speakingWpm: 120 }).readingSeconds).toBeCloseTo(21)
  })
  it('top words with and without stop words', () => {
    const t = computeStats('the cat and the dog and the cat')
    expect(t.topWords[0]).toEqual({ word: 'the', count: 3 })
    const f = computeStats('the cat and the dog and the cat', { excludeStopWords: true })
    expect(f.topWords[0]).toEqual({ word: 'cat', count: 2 })
  })
  it('graphemes vs UTF-16 vs bytes for emoji', () => {
    const e = computeStats('👩‍💻 ok')
    expect(e.graphemes).toBe(4)
    expect(e.characters).toBe('👩‍💻 ok'.length)
    expect(e.bytesUtf8).toBe(new TextEncoder().encode('👩‍💻 ok').length)
  })
  it('CRLF lines', () => {
    const c = computeStats('ab\r\ncdef\r\n')
    expect(c.lines).toBe(3)
    expect(c.longestLine).toEqual({ number: 2, length: 4, text: 'cdef' })
  })
  it('empty input', () => {
    const z = computeStats('')
    expect(z).toMatchObject({ characters: 0, words: 0, lines: 0, sentences: 0, paragraphs: 0, avgWordLength: 0, avgSentenceWords: 0, longestWord: '' })
  })
  it('large input', () => {
    const big = 'The quick brown fox jumps over the lazy dog. '.repeat(20_000)
    const t0 = performance.now()
    const r = computeStats(big)
    expect(r.words).toBe(180_000)
    expect(r.sentences).toBe(20_000)
    expect(performance.now() - t0).toBeLessThan(5000)
  })
})
