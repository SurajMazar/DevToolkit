import { describe, expect, it } from 'vitest'
import { buildDuplicateOutput, findDuplicates } from './duplicates'

const TEXT = ['apple', 'Banana', 'apple', '', 'cherry', 'banana ', '', 'apple', 'date'].join('\n')

describe('findDuplicates', () => {
  it('groups exact duplicates with line numbers (trim on by default)', () => {
    const r = findDuplicates(TEXT, { caseInsensitive: false })
    expect(r.groups).toEqual([{ text: 'apple', count: 3, lines: [1, 3, 8], variants: false }])
    expect(r.totalLines).toBe(9)
    expect(r.blankLines).toBe(2)
    expect(r.redundant).toBe(2)
    expect(r.distinct).toBe(5)
    expect(r.singles).toBe(4)
  })
  it('case-insensitive + trim folds variants', () => {
    const r = findDuplicates(TEXT, { caseInsensitive: true, trim: true })
    expect(r.groups[1]).toEqual({ text: 'Banana', count: 2, lines: [2, 6], variants: true })
  })
  it('without trim, surrounding whitespace matters', () => {
    const r = findDuplicates('a\na \n a', { trim: false })
    expect(r.groups).toEqual([])
    expect(findDuplicates('a\na \n a', { trim: true }).groups[0].count).toBe(3)
  })
  it('blank lines are ignored or reported', () => {
    expect(findDuplicates(TEXT, { ignoreBlank: true }).groups.some((g) => g.text === '')).toBe(false)
    const r = findDuplicates(TEXT, { ignoreBlank: false })
    expect(r.groups.find((g) => g.text === '')).toEqual({ text: '', count: 2, lines: [4, 7], variants: false })
  })
  it('orders by count, then first occurrence', () => {
    const r = findDuplicates('b\na\nb\na\nc\nc\nc')
    expect(r.groups.map((g) => g.text)).toEqual(['c', 'b', 'a'])
  })
  it('handles CRLF, trailing newline, empty input and unicode', () => {
    const r = findDuplicates('é\r\né\r\né\r\n👍\r\n👍\r\n')
    expect(r.totalLines).toBe(5)
    expect(r.groups.map((g) => [g.text, g.lines])).toEqual([['é', [1, 3]], ['👍', [4, 5]]])
    expect(findDuplicates('')).toMatchObject({ totalLines: 0, groups: [], distinct: 0 })
  })
  it('large input', () => {
    const big = Array.from({ length: 200_000 }, (_, i) => `row-${i % 1000}`).join('\n')
    const t0 = performance.now()
    const r = findDuplicates(big)
    expect(r.groups).toHaveLength(1000)
    expect(r.groups[0].count).toBe(200)
    expect(r.redundant).toBe(199_000)
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})

describe('buildDuplicateOutput', () => {
  const o = { caseInsensitive: true, trim: true, ignoreBlank: true }
  it('unique lines keep first occurrence and blank lines', () => {
    expect(buildDuplicateOutput(TEXT, 'unique', o)).toBe(['apple', 'Banana', '', 'cherry', '', 'date'].join('\n'))
  })
  it('only duplicated lines, each once', () => {
    expect(buildDuplicateOutput(TEXT, 'duplicated', o)).toBe('apple\nBanana')
  })
  it('all duplicate occurrences', () => {
    expect(buildDuplicateOutput(TEXT, 'duplicated-all', o)).toBe('apple\nBanana\napple\nbanana \napple')
  })
  it('lines that appear once', () => {
    expect(buildDuplicateOutput(TEXT, 'singles', o)).toBe('cherry\ndate')
  })
  it('keeps CRLF and trailing newline, empty stays empty', () => {
    expect(buildDuplicateOutput('a\r\nb\r\na\r\n', 'unique')).toBe('a\r\nb\r\n')
    expect(buildDuplicateOutput('', 'unique')).toBe('')
    expect(buildDuplicateOutput('a\nb', 'duplicated')).toBe('')
  })
})
