import { describe, expect, it } from 'vitest'
import { isIdentifier, parsePointer, resolveSegments, toDotPath, toJsonPath, toJsonPointer, toJsPath } from './paths'
import { locatePointer, skipValue } from './locate'
import { parseJson } from '@/engines/json/parse'

describe('path notations', () => {
  const segs = ['a', 0, 'b c', 'x.y', "it's", 'ünï', '$id', '0', '~/'] as const
  it('JSONPath', () => {
    expect(toJsonPath([])).toBe('$')
    expect(toJsonPath(['a', 0, 'b c'])).toBe('$.a[0]["b c"]')
    expect(toJsonPath([...segs])).toBe(`$.a[0]["b c"]["x.y"]["it's"]["ünï"].$id["0"]["~/"]`)
    expect(toJsonPath(["it's"], { quote: "'" })).toBe(`$['it\\'s']`)
    expect(toJsonPath(['say "hi"'], { quote: "'" })).toBe(`$['say "hi"']`)
  })
  it('JavaScript', () => {
    expect(toJsPath(['a', 0, 'b c'])).toBe('data.a[0]["b c"]')
    expect(toJsPath(['ünï', 'class', '1x'], 'obj')).toBe('obj.ünï.class["1x"]')
  })
  it('JSON Pointer escapes ~ and /', () => {
    expect(toJsonPointer([])).toBe('')
    expect(toJsonPointer(['a', 0, 'b c'])).toBe('/a/0/b c')
    expect(toJsonPointer(['a/b', 'm~n'])).toBe('/a~1b/m~0n')
    expect(parsePointer('/a~1b/m~0n')).toEqual(['a/b', 'm~n'])
    expect(parsePointer('')).toEqual([])
    expect(parsePointer('#')).toEqual([])
    expect(parsePointer('#/a%20b/0')).toEqual(['a b', '0'])
    expect(() => parsePointer('a/b')).toThrow(/must start/)
    expect(() => parsePointer('/a~2')).toThrow(/bad escape/)
    // ~01 must decode to ~1, not /
    expect(parsePointer('/~01')).toEqual(['~1'])
  })
  it('identifier detection', () => {
    expect(isIdentifier('abc')).toBe(true)
    expect(isIdentifier('$_x1')).toBe(true)
    expect(isIdentifier('名前')).toBe(true)
    expect(isIdentifier('1a')).toBe(false)
    expect(isIdentifier('a-b')).toBe(false)
    expect(isIdentifier('')).toBe(false)
  })
  it('resolves pointer segments, distinguishing indices', () => {
    const doc = { a: [{ b: 1 }], '0': 'zero' }
    expect(resolveSegments(doc, ['a', '0', 'b'])).toEqual({ found: true, value: 1, path: ['a', 0, 'b'] })
    expect(resolveSegments(doc, ['0'])).toEqual({ found: true, value: 'zero', path: ['0'] })
    expect(resolveSegments(doc, ['a', '01']).found).toBe(false)
    expect(resolveSegments(doc, ['a', '5']).found).toBe(false)
    expect(resolveSegments(doc, ['toString']).found).toBe(false)
  })
  it('dot paths', () => {
    expect(toDotPath(['a', 0, 'b'])).toBe('a[0].b')
    expect(toDotPath(['a', 0, 'b'], { arrays: 'dot' })).toBe('a.0.b')
    expect(toDotPath(['a', 0, 'b'], { arrays: 'wildcard', delimiter: '/' })).toBe('a[]/b')
  })
})

describe('locatePointer', () => {
  const text = `{
  "name": "Ada",
  "tags": ["x", "y", {"deep": [1, 2, 3]}],
  "a/b": {"m~n": true},
  "esc\\"aped": "va\\"l}ue",
  "empty": {},
  "n": null
}`
  it('finds values by pointer with line/column', () => {
    expect(locatePointer(text, '')).toMatchObject({ offset: 0, line: 1, column: 1, exact: true })
    const name = locatePointer(text, '/name')!
    expect(text.slice(name.offset, name.end)).toBe('"Ada"')
    expect(name).toMatchObject({ line: 2, column: 11, exact: true })
    expect(text.slice(name.keyOffset!, name.keyOffset! + 6)).toBe('"name"')
    const deep = locatePointer(text, '/tags/2/deep/1')!
    expect(text.slice(deep.offset, deep.end)).toBe('2')
    expect(deep.line).toBe(3)
    const esc = locatePointer(text, '/a~1b/m~0n')!
    expect(text.slice(esc.offset, esc.end)).toBe('true')
    const escaped = locatePointer(text, ['esc"aped'])!
    expect(text.slice(escaped.offset, escaped.end)).toBe('"va\\"l}ue"')
    expect(locatePointer(text, '/n')!.line).toBe(7)
    const obj = locatePointer(text, '/tags')!
    expect(text.slice(obj.offset, obj.end)).toBe('["x", "y", {"deep": [1, 2, 3]}]')
  })
  it('falls back to the deepest existing ancestor', () => {
    const miss = locatePointer(text, '/tags/9')!
    expect(miss.exact).toBe(false)
    expect(miss.depth).toBe(1)
    expect(text.slice(miss.offset, miss.offset + 1)).toBe('[')
    expect(locatePointer(text, '/nope/x')!).toMatchObject({ exact: false, depth: 0, offset: 0 })
    expect(locatePointer(text, '/empty/x')!).toMatchObject({ exact: false, depth: 1 })
  })
  it('uses the last duplicate key like JSON.parse', () => {
    const t = '{"a": 1, "a": 2}'
    const l = locatePointer(t, '/a')!
    expect(t.slice(l.offset, l.end)).toBe('2')
  })
  it('handles unicode keys, BOM, minified and empty text', () => {
    const t = '﻿{"ключ":{"😀":[0,{"x":"y"}]}}'
    const l = locatePointer(t, '/ключ/😀/1/x')!
    expect(t.slice(l.offset, l.end)).toBe('"y"')
    expect(locatePointer('   ', '/a')).toBeNull()
    expect(skipValue('-1.5e3,', 0)).toBe(6)
  })
  it('agrees with the parser on a large generated document', () => {
    const doc = { items: Array.from({ length: 3000 }, (_, i) => ({ id: i, name: `item ${i}`, nested: { list: [i, `"${i}"`, { k: i }] } })) }
    const t = JSON.stringify(doc, null, 2)
    const l = locatePointer(t, '/items/2999/nested/list/2/k')!
    expect(l.exact).toBe(true)
    expect(t.slice(l.offset, l.end)).toBe('2999')
    const parsed = parseJson(t.slice(locatePointer(t, '/items/1500')!.offset, locatePointer(t, '/items/1500')!.end))
    expect(parsed.ok && (parsed.value as { id: number }).id).toBe(1500)
  })
})
