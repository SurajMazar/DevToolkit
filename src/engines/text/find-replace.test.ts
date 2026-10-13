import { describe, expect, it } from 'vitest'
import { findMatches, replaceAll } from '@/engines/regex/core'
import { buildLineIndex, checkReplacement, DEFAULT_FIND_OPTIONS, matchIndexAtOrAfter, positionAt, prepareReplacement, prepareSearch, previewReplacements, visualize, type FindOptions } from './find-replace'

const opts = (o: Partial<FindOptions> = {}): FindOptions => ({ ...DEFAULT_FIND_OPTIONS, ...o })

function replace(text: string, query: string, rep: string, o: Partial<FindOptions> = {}) {
  const s = prepareSearch(query, opts(o))
  if (!s.ok) throw new Error(s.error)
  return replaceAll(s.search.pattern, s.search.flags, text, prepareReplacement(rep, opts(o).regex)).output
}

describe('prepareSearch', () => {
  it('plain text escapes regex metacharacters', () => {
    const s = prepareSearch('a.b*(c)', opts())
    expect(s.ok).toBe(true)
    if (s.ok) expect(findMatches(s.search.pattern, s.search.flags, 'a.b*(c) axb').total).toBe(1)
  })
  it('case sensitivity', () => {
    expect(replace('Foo foo FOO', 'foo', 'x')).toBe('x x x')
    expect(replace('Foo foo FOO', 'foo', 'x', { caseSensitive: true })).toBe('Foo x FOO')
  })
  it('whole word, unicode aware', () => {
    expect(replace('cat concat cat_x café cat', 'cat', 'dog', { wholeWord: true })).toBe('dog concat cat_x café dog')
    expect(replace('caféx café', 'café', 'tea', { wholeWord: true })).toBe('caféx tea')
  })
  it('reports invalid patterns', () => {
    const s = prepareSearch('(abc', opts({ regex: true }))
    expect(s.ok).toBe(false)
    if (!s.ok) expect(s.error).toMatch(/Unterminated group/i)
    // In plain mode the same text is fine.
    expect(prepareSearch('(abc', opts()).ok).toBe(true)
  })
  it('multiline and dotAll flags apply only to regex mode', () => {
    const m = prepareSearch('^a', opts({ regex: true, multiline: true }))
    expect(m.ok && m.search.flags.includes('m')).toBe(true)
    const nm = prepareSearch('^a', opts({ regex: true, multiline: false }))
    expect(nm.ok && nm.search.flags.includes('m')).toBe(false)
    const plain = prepareSearch('^a', opts({ regex: false, multiline: true, dotAll: true }))
    expect(plain.ok && /[ms]/.test(plain.search.flags)).toBe(false)
    expect(replace('a\nb', 'a.b', 'X', { regex: true, dotAll: true })).toBe('X')
    expect(replace('a\nb', 'a.b', 'X', { regex: true, dotAll: false })).toBe('a\nb')
    expect(replace('x1\nx2', '^x', 'y', { regex: true, multiline: true })).toBe('y1\ny2')
    expect(replace('x1\nx2', '^x', 'y', { regex: true, multiline: false })).toBe('y1\nx2')
  })
  it('reports group count and names', () => {
    const s = prepareSearch('(?<year>\\d{4})-(\\d{2})', opts({ regex: true }))
    expect(s.ok && s.groupCount).toBe(2)
    expect(s.ok && s.groupNames).toEqual(['year'])
  })
  it('unicode toggle allows legacy escapes', () => {
    expect(prepareSearch('\\_', opts({ regex: true, unicode: true })).ok).toBe(false)
    expect(prepareSearch('\\_', opts({ regex: true, unicode: false })).ok).toBe(true)
  })
})

describe('replacement', () => {
  it('plain mode treats $ literally', () => {
    expect(replace('price', 'price', '$1.00 $&')).toBe('$1.00 $&')
  })
  it('regex mode supports $1, $<name>, $& and escapes', () => {
    expect(replace('2024-05-06', '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1', { regex: true })).toBe('06/05/2024')
    expect(replace('John Smith', '(?<first>\\w+) (?<last>\\w+)', '$<last>, $<first>', { regex: true })).toBe('Smith, John')
    expect(replace('a,b', ',', '\\n', { regex: true })).toBe('a\nb')
    expect(replace('a b', ' ', '\\t[$&]\\\\', { regex: true })).toBe('a\t[ ]\\b')
    expect(replace('ab', 'b', '$$', { regex: true })).toBe('a$')
  })
  it('works across CRLF multiline content', () => {
    // JavaScript treats \r as a line terminator too, so with "m" `$` also matches before \r.
    expect(replace('one\r\ntwo\r\n', '$', ';', { regex: true, multiline: true })).toBe('one;\r;\ntwo;\r;\n;')
    expect(replace('one\r\ntwo\r\n', '(?<!\\r)(?=\\r?\\n)', ';', { regex: true })).toBe('one;\r\ntwo;\r\n')
    expect(replace('one\r\ntwo', '\\r?\\n', ' | ', { regex: true })).toBe('one | two')
  })
  it('checkReplacement warns about unknown groups', () => {
    expect(checkReplacement('$1', 1, [])).toBeNull()
    expect(checkReplacement('$2', 1, [])).toMatch(/only 1 capture group/)
    expect(checkReplacement('$1', 0, [])).toMatch(/no capture groups/)
    expect(checkReplacement('$12', 1, [])).toBeNull()
    expect(checkReplacement('$$1', 0, [])).toBeNull()
    expect(checkReplacement('$<x>', 1, ['y'])).toMatch(/does not exist/)
    expect(checkReplacement('$<y>', 1, ['y'])).toBeNull()
    expect(checkReplacement('$0 $&', 0, [])).toBeNull()
  })
})

describe('previews and positions', () => {
  it('previewReplacements expands each match with line/column', () => {
    const text = 'id=1\nid=22'
    const s = prepareSearch('id=(?<n>\\d+)', opts({ regex: true }))
    if (!s.ok) throw new Error()
    const m = findMatches(s.search.pattern, s.search.flags, text)
    const p = previewReplacements(text, m.matches, prepareReplacement('n:$<n>/$1', true))
    expect(p).toEqual([
      { index: 0, end: 4, before: 'id=1', after: 'n:1/1', line: 1, column: 1 },
      { index: 5, end: 10, before: 'id=22', after: 'n:22/22', line: 2, column: 1 },
    ])
  })
  it('handles emoji offsets in UTF-16', () => {
    const text = '👍 ok\n👍👍 ok'
    const s = prepareSearch('ok', opts())
    if (!s.ok) throw new Error()
    const m = findMatches(s.search.pattern, s.search.flags, text)
    const p = previewReplacements(text, m.matches, 'OK')
    expect(p.map((x) => [x.line, x.column])).toEqual([[1, 4], [2, 6]])
  })
  it('line index handles LF, CRLF and CR', () => {
    const idx = buildLineIndex('a\r\nb\rc\nd')
    expect(idx).toEqual([0, 3, 5, 7])
    expect(positionAt(idx, 0)).toEqual({ line: 1, column: 1 })
    expect(positionAt(idx, 4)).toEqual({ line: 2, column: 2 })
    expect(positionAt(idx, 7)).toEqual({ line: 4, column: 1 })
    expect(positionAt(buildLineIndex(''), 0)).toEqual({ line: 1, column: 1 })
  })
  it('matchIndexAtOrAfter wraps around', () => {
    const ms = [{ index: 2 }, { index: 10 }, { index: 20 }]
    expect(matchIndexAtOrAfter(ms, 0)).toBe(0)
    expect(matchIndexAtOrAfter(ms, 10)).toBe(1)
    expect(matchIndexAtOrAfter(ms, 11)).toBe(2)
    expect(matchIndexAtOrAfter(ms, 21)).toBe(0)
    expect(matchIndexAtOrAfter([], 5)).toBe(-1)
  })
  it('visualize shows whitespace and truncates', () => {
    expect(visualize('a\r\nb\tc')).toBe('a↵b→c')
    expect(visualize('x'.repeat(10), 4)).toBe('xxxx…')
  })
  it('large input', () => {
    const text = 'lorem ipsum dolor\n'.repeat(50_000)
    const s = prepareSearch('ipsum', opts({ wholeWord: true }))
    if (!s.ok) throw new Error()
    const r = replaceAll(s.search.pattern, s.search.flags, text, 'IPSUM')
    expect(r.count).toBe(50_000)
    const m = findMatches(s.search.pattern, s.search.flags, text, 10_000)
    expect(m.capped).toBe(true)
    expect(previewReplacements(text, m.matches, 'X', 500)).toHaveLength(500)
  })
})
