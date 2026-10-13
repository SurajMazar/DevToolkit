import { describe, expect, it } from 'vitest'
import { applyJsonPatch, canonicalNumber, diffJson, jsonPatch, NodeStatus, parsePathPattern, pathMatches, pathToText } from './json-diff'
import { parseJson } from '../json/parse'

const parse = (s: string) => {
  const r = parseJson(s)
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}

describe('diffJson', () => {
  it('detects identical documents regardless of key order', () => {
    expect(diffJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }).identical).toBe(true)
  })
  it('reports added, removed, modified and type changes with paths', () => {
    const r = diffJson({ a: 1, b: 'x', c: true, d: { e: 1 } }, { a: 2, b: 'x', c: 'true', f: null, d: {} })
    const by = Object.fromEntries(r.changes.map((c) => [c.pathText, c.type]))
    expect(by).toEqual({ '$.a': 'modified', '$.c': 'type', '$.d.e': 'removed', '$.f': 'added' })
    expect(r.stats).toMatchObject({ added: 1, removed: 1, modified: 1, typeChanged: 1 })
  })
  it('loose types treat "1" and 1 as equal', () => {
    expect(diffJson({ a: '1', b: 'true' }, { a: 1, b: true }, { looseTypes: true }).identical).toBe(true)
    expect(diffJson({ a: '1' }, { a: 1 }).changes[0].type).toBe('type')
  })
  it('compares numbers by exact value, including big numbers', () => {
    expect(diffJson(parse('{"a": 1.0, "b": 12345678901234567890}'), parse('{"a": 1, "b": 12345678901234567890}')).identical).toBe(true)
    const r = diffJson(parse('{"b": 12345678901234567890}'), parse('{"b": 12345678901234567891}'))
    expect(r.changes).toHaveLength(1)
    expect(canonicalNumber('1.50e2')).toBe(canonicalNumber('150'))
  })
  it('smart array matching handles insertions without cascading changes', () => {
    const r = diffJson({ xs: [1, 2, 3, 4] }, { xs: [1, 9, 2, 3, 4] })
    expect(r.changes).toHaveLength(1)
    expect(r.changes[0]).toMatchObject({ type: 'added', pathText: '$.xs[1]' })
    const byIndex = diffJson({ xs: [1, 2, 3, 4] }, { xs: [1, 9, 2, 3, 4] }, { arrayMatch: 'index' })
    expect(byIndex.changes.length).toBe(4)
  })
  it('pairs the most similar elements inside a change block', () => {
    const left = { items: [{ sku: 'A', qty: 1 }, { sku: 'M', name: 'Mouse', qty: 2, price: 39 }, { sku: 'C', qty: 3 }] }
    const right = { items: [{ sku: 'A', qty: 1 }, { sku: 'H', name: 'Headphones', qty: 1, price: 89 }, { sku: 'M', name: 'Mouse', qty: 1, price: 39 }, { sku: 'C', qty: 3 }] }
    const r = diffJson(left, right)
    const by = Object.fromEntries(r.changes.map((c) => [c.pathText, c.type]))
    expect(by).toEqual({ '$.items[1]': 'added', '$.items[1].qty': 'modified' })
    const mod = r.changes.find((c) => c.type === 'modified')!
    expect(mod.leftPointer).toBe('/items/1/qty')
    expect(mod.rightPointer).toBe('/items/2/qty')
  })
  it('matches arrays by identifier key', () => {
    const left = { users: [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bob' }, { id: 3, name: 'Cy' }] }
    const right = { users: [{ id: 3, name: 'Cy' }, { id: 1, name: 'Anne' }, { id: 4, name: 'Dee' }] }
    const r = diffJson(left, right, { arrayMatch: 'key', arrayKeys: ['id'] })
    const by = Object.fromEntries(r.changes.map((c) => [c.pathText, c.type]))
    expect(by).toEqual({ '$.users[id=1].name': 'modified', '$.users[1]': 'removed', '$.users[2]': 'added' })
    const mod = r.changes.find((c) => c.type === 'modified')!
    expect(mod.leftPointer).toBe('/users/0/name')
    expect(mod.rightPointer).toBe('/users/1/name')
  })
  it('ignores array order when asked', () => {
    expect(diffJson([1, 2, { a: 1 }], [{ a: 1 }, 2, 1], { ignoreArrayOrder: true }).identical).toBe(true)
  })
  it('ignores paths via glob patterns', () => {
    const l = { meta: { updatedAt: 1, v: 1 }, items: [{ ts: 1, n: 1 }, { ts: 2, n: 2 }], deep: { x: { etag: 'a' } } }
    const r = { meta: { updatedAt: 2, v: 1 }, items: [{ ts: 9, n: 1 }, { ts: 8, n: 2 }], deep: { x: { etag: 'b' } } }
    const res = diffJson(l, r, { ignorePaths: ['$.meta.updatedAt', 'items[*].ts', '**.etag'] })
    expect(res.identical).toBe(true)
    expect(res.stats.ignored).toBe(4)
  })
  it('detects key order changes when asked', () => {
    const r = diffJson({ a: 1, b: 2 }, { b: 2, a: 1 }, { detectKeyOrder: true })
    expect(r.changes.map((c) => c.type)).toEqual(['order'])
  })
  it('ignores string case when asked', () => expect(diffJson({ a: 'Hello' }, { a: 'hello' }, { ignoreStringCase: true }).identical).toBe(true))
  it('builds a tree table with statuses and subtree counts', () => {
    const r = diffJson({ a: { b: 1, c: 2 }, z: 0 }, { a: { b: 1, c: 3 }, z: 0 })
    const t = r.tree
    expect(t.keys).toEqual(['$', 'a', 'b', 'c', 'z'])
    expect(Array.from(t.status)).toEqual([NodeStatus.Contains, NodeStatus.Contains, NodeStatus.Equal, NodeStatus.Modified, NodeStatus.Equal])
    expect(Array.from(t.changes)).toEqual([1, 1, 0, 1, 0])
    expect(Array.from(t.end)).toEqual([5, 4, 3, 4, 5])
  })
  it('handles root-level type differences and primitives', () => {
    expect(diffJson(1, '1').changes[0].type).toBe('type')
    expect(diffJson(null, null).identical).toBe(true)
  })
  it('handles a large document quickly', () => {
    const mk = (n: number, edit: boolean) => ({ items: Array.from({ length: n }, (_, i) => ({ id: i, name: `item ${i}`, price: i * 1.5, tags: ['a', 'b'], nested: { flag: edit && i % 1000 === 0 } })) })
    const t = performance.now()
    const r = diffJson(mk(20_000, false), mk(20_000, true))
    expect(r.changes.length).toBe(20)
    expect(performance.now() - t).toBeLessThan(4000)
  })
})

describe('paths', () => {
  it('renders JSONPath text', () => expect(pathToText(['a', 0, 'b c', { key: 'id', value: '7', leftIndex: 1, rightIndex: 2 }])).toBe('$.a[0]["b c"][id=7]'))
  it('matches patterns', () => {
    expect(pathMatches(parsePathPattern('$.a.b'), ['a', 'b'])).toBe(true)
    expect(pathMatches(parsePathPattern('a.*'), ['a', 'x'])).toBe(true)
    expect(pathMatches(parsePathPattern('a[*].t'), ['a', 3, 't'])).toBe(true)
    expect(pathMatches(parsePathPattern('**.t'), ['x', 'y', 't'])).toBe(true)
    expect(pathMatches(parsePathPattern('/a/0'), ['a', 0])).toBe(true)
    expect(pathMatches(parsePathPattern('$["weird key"]'), ['weird key'])).toBe(true)
    expect(pathMatches(parsePathPattern('a.b'), ['a', 'b', 'c'])).toBe(false)
  })
  it('rejects malformed patterns', () => expect(() => parsePathPattern('a..[')).toThrow())
})

describe('jsonPatch', () => {
  const cases: [unknown, unknown][] = [
    [{ a: 1, b: [1, 2, 3], c: { d: 'x' } }, { a: 2, b: [1, 3, 4], e: true, c: { d: 'y', f: [] } }],
    [[1, 2, 3, 4, 5], [0, 1, 3, 5, 6, 7]],
    [{ list: [{ id: 1 }, { id: 2 }] }, { list: [{ id: 2 }, { id: 1, x: 1 }] }],
    [{ 'a/b': 1, 'c~d': 2 }, { 'a/b': 3 }],
    ['x', { y: 1 }],
  ]
  for (const [l, r] of cases) it(`transforms ${JSON.stringify(l)}`, () => expect(applyJsonPatch(l, jsonPatch(l, r))).toEqual(r))
})
