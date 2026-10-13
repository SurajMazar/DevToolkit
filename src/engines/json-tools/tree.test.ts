import { describe, expect, it } from 'vitest'
import { parseJson } from '@/engines/json/parse'
import { buildTree, containerPreview, expandAll, expandAncestors, expandToDepth, NodeType, pathOf, searchTree, subtreeToJson, TreeTooLargeError, typeCounts, visibleRows } from './tree'
import { parseToTree } from './tasks'

const parse = (t: string) => {
  const r = parseJson(t)
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}

describe('buildTree', () => {
  const doc = parse('{"user":{"id":12345678901234567890,"name":"Ada","tags":["a","b"],"active":true,"note":null},"empty":[],"ключ":{}}')
  const t = buildTree(doc)
  it('indexes nodes in pre-order with parents, depths and child counts', () => {
    expect(t.size).toBe(11)
    expect(t.keys).toEqual(['', 'user', 'id', 'name', 'tags', '0', '1', 'active', 'note', 'empty', 'ключ'])
    expect(t.type[0]).toBe(NodeType.Object)
    expect(t.childCount[0]).toBe(3)
    expect(t.childCount[1]).toBe(5)
    expect(t.parent[2]).toBe(1)
    expect(t.depth[5]).toBe(3)
    expect(t.isIndex[5]).toBe(1)
    expect(t.end[0]).toBe(t.size)
    expect(t.end[1]).toBe(9)
    expect(t.maxDepth).toBe(3)
  })
  it('keeps big numbers as digit strings', () => {
    expect(t.type[2]).toBe(NodeType.Number)
    expect(t.values[2]).toBe('12345678901234567890')
  })
  it('round-trips subtrees to JSON exactly', () => {
    expect(subtreeToJson(t, 0, 0)).toBe('{"user":{"id":12345678901234567890,"name":"Ada","tags":["a","b"],"active":true,"note":null},"empty":[],"ключ":{}}')
    expect(subtreeToJson(t, 4, 2)).toBe('[\n  "a",\n  "b"\n]')
    expect(subtreeToJson(t, 3)).toBe('"Ada"')
  })
  it('computes paths', () => {
    expect(pathOf(t, 6)).toEqual(['user', 'tags', 1])
    expect(pathOf(t, 0)).toEqual([])
  })
  it('previews and counts', () => {
    expect(containerPreview(t, 1, 3)).toBe('id, name, tags, …')
    expect(typeCounts(t)).toEqual({ object: 3, array: 2, string: 3, number: 1, boolean: 1, null: 1 })
  })
  it('primitive roots', () => {
    const p = buildTree('hello')
    expect(p.size).toBe(1)
    expect(subtreeToJson(p, 0)).toBe('"hello"')
  })
  it('enforces the node limit', () => {
    expect(() => buildTree([1, 2, 3, 4], 3)).toThrow(TreeTooLargeError)
  })
})

describe('visibility and expansion', () => {
  const t = buildTree({ a: { b: { c: 1 } }, d: [1, 2] })
  it('collapsed root shows only the root', () => {
    expect([...visibleRows(t, new Uint8Array(t.size))]).toEqual([0])
  })
  it('expand to depth', () => {
    const e = expandToDepth(t, 1)
    expect([...visibleRows(t, e)].map((i) => t.keys[i])).toEqual(['', 'a', 'd'])
    expect([...visibleRows(t, expandAll(t))].length).toBe(t.size)
  })
  it('expandAncestors reveals a deep node', () => {
    const e = new Uint8Array(t.size)
    const c = t.keys.indexOf('c')
    expect(expandAncestors(t, e, c)).toBe(true)
    expect([...visibleRows(t, e)]).toContain(c)
    expect(expandAncestors(t, e, c)).toBe(false)
  })
})

describe('searchTree', () => {
  const t = buildTree({ Name: 'Alice', items: [{ name: 'apple' }, { title: 'NAMEless' }], n: 42 })
  it('searches keys and values case-insensitively', () => {
    const r = searchTree(t, 'name', { keys: true, values: true })
    expect([...r.matches].map((i) => t.keys[i])).toEqual(['Name', 'name', 'title'])
    expect(searchTree(t, 'name', { keys: true, values: false }).matches.length).toBe(2)
    expect(searchTree(t, 'name', { keys: false, values: true }).matches.length).toBe(1)
    expect(searchTree(t, 'Name', { keys: true, values: true, caseSensitive: true }).matches.length).toBe(1)
    expect(searchTree(t, '42', { keys: false, values: true }).matches.length).toBe(1)
    expect(searchTree(t, '', { keys: true, values: true }).matches.length).toBe(0)
  })
  it('does not match array indices as keys', () => {
    expect(searchTree(t, '0', { keys: true, values: false }).matches.length).toBe(0)
  })
  it('caps results', () => {
    const big = buildTree(Array.from({ length: 50 }, () => 'x'))
    const r = searchTree(big, 'x', { keys: false, values: true, limit: 10 })
    expect(r.capped).toBe(true)
    expect(r.matches.length).toBe(10)
  })
})

describe('large and deep documents', () => {
  it('handles 100k+ nodes quickly', () => {
    const doc = { rows: Array.from({ length: 25_000 }, (_, i) => ({ id: i, name: `row ${i}`, ok: i % 2 === 0 })) }
    const t0 = performance.now()
    const t = buildTree(doc)
    expect(t.size).toBe(1 + 1 + 25_000 * 4)
    const rows = visibleRows(t, expandAll(t))
    expect(rows.length).toBe(t.size)
    expect(searchTree(t, 'row 24999', { keys: false, values: true }).matches.length).toBe(1)
    expect(performance.now() - t0).toBeLessThan(3000)
  })
  it('handles deep nesting without recursion limits in the builder', () => {
    let v: unknown = 'leaf'
    for (let i = 0; i < 5000; i++) v = { k: v }
    const t = buildTree(v)
    expect(t.size).toBe(5001)
    expect(t.maxDepth).toBe(5000)
    expect(pathOf(t, 5000).length).toBe(5000)
  })
  it('parseToTree reports parse errors with location', () => {
    const r = parseToTree('{\n  "a": 1,\n  "b": }')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.line).toBe(3)
  })
})

describe('expansion carry-over', () => {
  it('maps expanded branches by pointer and keeps selection', async () => {
    const { carryExpansion, nodeForPointer, pointersOf, setSubtreeExpanded } = await import('./tree')
    const a = buildTree({ x: { y: [1, { z: 1 }] }, 'a/b': { c: 1 } })
    expect(pointersOf(a)).toEqual(['', '/x', '/x/y', '/x/y/0', '/x/y/1', '/x/y/1/z', '/a~1b', '/a~1b/c'])
    const e = new Uint8Array(a.size)
    e[0] = 1
    e[2] = 1
    e[6] = 1
    const b = buildTree({ new: 1, x: { y: [0, { z: 2 }, 3] }, 'a/b': 'now a string' })
    const carried = carryExpansion(a, e, b)!
    const open = [...carried].map((v, i) => (v ? pointersOf(b)[i] : null)).filter((x) => x !== null)
    expect(open).toEqual(['', '/x/y'])
    expect(nodeForPointer(b, '/x/y/1/z')).toBe(6)
    expect(nodeForPointer(b, '/missing')).toBe(-1)
    expect(carryExpansion(a, e, b, 3)).toBeNull()
    const all = new Uint8Array(b.size)
    setSubtreeExpanded(b, all, 2, true)
    expect([...visibleRows(b, all)].length).toBe(1)
    all[0] = 1
    expect([...visibleRows(b, all)].length).toBe(b.size)
  })
})

describe('tool sample', () => {
  it('parses the sample with its 64-bit reference intact', async () => {
    const { TREE_SAMPLE } = await import('@/tools/json/tree-viewer/sample')
    const r = parseToTree(TREE_SAMPLE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.hasBigNumbers).toBe(true)
    expect(r.value.values).toContain('9223372036854775807')
  })
})
