import { describe, expect, it } from 'vitest'
import { buildSearch, compileRegex, escapeRegex, expandReplacement, findMatches, replaceAll } from './core'

describe('regex core', () => {
  it('compiles and reports group info', () => {
    expect(compileRegex('(a)(?<x>b)', 'g')).toMatchObject({ ok: true, groupCount: 2, groupNames: ['x'] })
    expect(compileRegex('(', 'g').ok).toBe(false)
  })
  it('finds matches with groups and indices', () => {
    const r = findMatches('(?<y>\\d{4})-(\\d{2})', 'g', 'on 2024-05 and 2025-06')
    expect(r.total).toBe(2)
    expect(r.matches[0]).toMatchObject({ index: 3, end: 10, text: '2024-05' })
    expect(r.matches[0].groups[0]).toMatchObject({ index: 1, name: 'y', text: '2024', start: 3, end: 7 })
    expect(r.matches[1].groups[1].text).toBe('06')
  })
  it('returns only the first match without g', () => expect(findMatches('a', '', 'aaa').total).toBe(1))
  it('handles empty matches without looping', () => expect(findMatches('x*', 'g', 'abc').total).toBe(4))
  it('caps results', () => {
    const r = findMatches('a', 'g', 'a'.repeat(100), 10)
    expect(r.matches).toHaveLength(10)
    expect(r.capped).toBe(true)
  })
  it('replaces with $ syntax', () => {
    expect(replaceAll('(\\w+)@(\\w+)', 'g', 'me@host you@there', '$2:$1').output).toBe('host:me there:you')
    expect(replaceAll('(?<n>\\d)', 'g', 'a1b2', '[$<n>]')).toEqual({ output: 'a[1]b[2]', count: 2 })
    expect(replaceAll('b', 'g', 'abc', "$`|$&|$'|$$").output).toBe('aa|b|c|$c')
  })
  it('expands two-digit refs correctly', () => expect(expandReplacement('$12', 'x', ['A'], 0, 'x')).toBe('A2'))
  it('escapes literals', () => expect(new RegExp(escapeRegex('a.b*c')).test('a.b*c')).toBe(true))
  it('builds whole-word, case-insensitive searches', () => {
    const { pattern, flags } = buildSearch('cat', { regex: false, caseSensitive: false, wholeWord: true })
    expect(findMatches(pattern, flags, 'Cat concat cat_x cat.').total).toBe(2)
  })
})
