import { describe, expect, it } from 'vitest'
import { parseJson } from '@/engines/json/parse'
import { stringifyJson } from '@/engines/json/stringify'
import { compareStructure, deepMerge, extractKeyPaths, extractLeafValues, flatten, formatStructureDiff, prune, sortKeys, splitFlatKey, unflatten } from './object-utils'
import { DEFAULT_OBJECT_OPTIONS, runObjectOp } from './tasks'

const parse = (t: string) => {
  const r = parseJson(t)
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}

const doc = { user: { name: 'Ada', tags: ['x', 'y'], address: { city: 'Oslo' } }, list: [{ a: 1 }, { b: [true] }], empty: {}, none: [] }

describe('flatten / unflatten', () => {
  it('flattens with dot notation and keeps empty containers', () => {
    expect(flatten(doc).value).toEqual({
      'user.name': 'Ada',
      'user.tags.0': 'x',
      'user.tags.1': 'y',
      'user.address.city': 'Oslo',
      'list.0.a': 1,
      'list.1.b.0': true,
      empty: {},
      none: [],
    })
  })
  it('bracket arrays and custom delimiters', () => {
    expect(flatten(doc, { arrays: 'bracket' }).value).toMatchObject({ 'user.tags[0]': 'x', 'list[1].b[0]': true })
    expect(flatten(doc, { delimiter: '/' }).value).toMatchObject({ 'user/address/city': 'Oslo' })
    expect(flatten(doc, { delimiter: '__' }).value).toMatchObject({ user__address__city: 'Oslo' })
    expect(flatten([1, [2]], { arrays: 'bracket' }).value).toEqual({ '[0]': 1, '[1][0]': 2 })
  })
  it('max depth keeps deeper values nested', () => {
    expect(flatten(doc, { maxDepth: 1 }).value).toMatchObject({ user: doc.user })
    expect(flatten(doc, { maxDepth: 2 }).value).toMatchObject({ 'user.address': { city: 'Oslo' }, 'user.tags': ['x', 'y'] })
  })
  it('reports ambiguous keys and collisions', () => {
    const r = flatten({ 'a.b': 1, a: { b: 2 } })
    expect(r.ambiguousKeys).toEqual(['a.b'])
    expect(r.collisions).toEqual(['a.b'])
  })
  it('round-trips through unflatten (dot and bracket)', () => {
    expect(unflatten(flatten(doc).value)).toEqual(doc)
    expect(unflatten(flatten(doc, { arrays: 'bracket' }).value)).toEqual(doc)
    expect(unflatten(flatten(doc, { delimiter: '/' }).value, { delimiter: '/' })).toEqual(doc)
    expect(unflatten(flatten([{ a: 1 }, 2]).value)).toEqual([{ a: 1 }, 2])
  })
  it('numeric keys as object keys when requested', () => {
    expect(unflatten({ 'a.0': 'x', 'a.1': 'y' }, { numericArrays: false })).toEqual({ a: { '0': 'x', '1': 'y' } })
    expect(unflatten({ 'a.0': 'x', 'a.2': 'z' })).toEqual({ a: ['x', null, 'z'] })
  })
  it('splits mixed keys', () => {
    expect(splitFlatKey('users[0].tags[1]', '.', true)).toEqual(['users', 0, 'tags', 1])
    expect(splitFlatKey('[0][1]', '.', true)).toEqual([0, 1])
    expect(splitFlatKey('a.b', '.', false)).toEqual(['a', 'b'])
  })
  it('explains conflicts', () => {
    expect(() => unflatten({ a: 1, 'a.b': 2 })).toThrow(/conflicts/)
    expect(() => unflatten({ 'a.b': 2, a: 1 })).toThrow(/conflicts/)
    expect(() => unflatten({ 'a.0': 1, 'a.x': 2 })).toThrow(/both an array and an object/)
    expect(() => unflatten([1])).toThrow(/flat JSON object/)
    expect(() => flatten('x')).toThrow(/object or array/)
  })
  it('is safe with __proto__ keys', () => {
    const v = parse('{"__proto__.polluted": 1, "a.__proto__": {"x": 1}}')
    const r = unflatten(v) as Record<string, unknown>
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(r)).toEqual(['__proto__', 'a'])
    expect(stringifyJson(r)).toBe('{"__proto__":{"polluted":1},"a":{"__proto__":{"x":1}}}')
    expect(Object.keys(flatten(parse('{"__proto__":{"a":1}}')).value)).toEqual(['__proto__.a'])
  })
  it('keeps big numbers exact', () => {
    const v = parse('{"a":{"id":12345678901234567890}}')
    expect(stringifyJson(flatten(v).value)).toBe('{"a.id":12345678901234567890}')
    expect(stringifyJson(unflatten(flatten(v).value))).toBe('{"a":{"id":12345678901234567890}}')
  })
  it('flattens a large array', () => {
    const big = { rows: Array.from({ length: 20_000 }, (_, i) => ({ id: i, v: { w: i } })) }
    const f = flatten(big)
    expect(Object.keys(f.value).length).toBe(40_000)
    expect(unflatten(f.value)).toEqual(big)
  })
})

describe('sortKeys', () => {
  const v = { b: 1, a: { d: 1, c: 2 }, item10: 1, item2: 1, Z: 1, list: [{ y: 1, x: 2 }] }
  it('deep natural ascending', () => {
    const r = sortKeys(v) as Record<string, unknown>
    expect(Object.keys(r)).toEqual(['a', 'b', 'item2', 'item10', 'list', 'Z'])
    expect(Object.keys(r.a as object)).toEqual(['c', 'd'])
    expect(Object.keys((r.list as object[])[0])).toEqual(['x', 'y'])
  })
  it('descending and code-point', () => {
    expect(Object.keys(sortKeys(v, { order: 'desc' }) as object)).toEqual(['Z', 'list', 'item10', 'item2', 'b', 'a'])
    expect(Object.keys(sortKeys(v, { collation: 'codepoint' }) as object)).toEqual(['Z', 'a', 'b', 'item10', 'item2', 'list'])
  })
  it('shallow sort leaves nested objects alone', () => {
    const r = sortKeys(v, { deep: false }) as Record<string, unknown>
    expect(Object.keys(r.a as object)).toEqual(['d', 'c'])
  })
  it('unicode keys and arrays order preserved', () => {
    expect(Object.keys(sortKeys({ 'é': 1, e: 2, f: 3 }) as object)).toEqual(['e', 'é', 'f'])
    expect(sortKeys([3, 1, 2])).toEqual([3, 1, 2])
  })
})

describe('prune', () => {
  const v = { a: null, b: '', c: [], d: {}, e: { f: null }, g: [null, 1, '', []], h: 0, i: false }
  it('removes nulls (object fields only by default)', () => {
    expect(prune(v, { null: true, cascade: false })).toEqual({ value: { b: '', c: [], d: {}, e: {}, g: [null, 1, '', []], h: 0, i: false }, removed: 2 })
    expect(prune(v, { null: true, inArrays: true, cascade: false }).value).toMatchObject({ g: [1, '', []] })
  })
  it('removes empties with cascade', () => {
    const r = prune(v, { null: true, emptyString: true, emptyArray: true, emptyObject: true })
    expect(r.value).toEqual({ g: [null, 1, '', []], h: 0, i: false })
    expect(prune(v, { null: true, emptyString: true, emptyArray: true, emptyObject: true, inArrays: true }).value).toEqual({ g: [1], h: 0, i: false })
  })
  it('without cascade, containers emptied by pruning stay', () => {
    expect(prune({ e: { f: null } }, { null: true, emptyObject: true, cascade: false }).value).toEqual({ e: {} })
  })
  it('configurable kinds', () => {
    expect(prune(v, { emptyString: true }).value).not.toHaveProperty('b')
    expect(prune(v, { emptyString: true }).value).toHaveProperty('a')
  })
})

describe('extract', () => {
  it('key paths, collapsed and expanded', () => {
    expect(extractKeyPaths(doc)).toEqual(['user', 'user.name', 'user.tags', 'user.tags[]', 'user.address', 'user.address.city', 'list', 'list[]', 'list[].a', 'list[].b', 'list[].b[]', 'empty', 'none'])
    expect(extractKeyPaths(doc, { leavesOnly: true })).toEqual(['user.name', 'user.tags[]', 'user.address.city', 'list[].a', 'list[].b[]', 'empty', 'none'])
    expect(extractKeyPaths({ a: [{ x: 1 }, { x: 2 }] }, { collapseIndices: false, leavesOnly: true })).toEqual(['a[0].x', 'a[1].x'])
  })
  it('leaf values', () => {
    expect(extractLeafValues({ a: 1, b: ['x', 1, null], c: { d: 'x' } })).toEqual([1, 'x', 1, null, 'x'])
    expect(extractLeafValues({ a: 1, b: ['x', 1, '1', null], c: { d: 'x' } }, { unique: true })).toEqual([1, 'x', '1', null])
  })
})

describe('deepMerge', () => {
  const a = { name: 'A', cfg: { x: 1, list: [1, 2], keep: true }, arr: [{ id: 1, v: 'a' }] }
  const b = { cfg: { x: 2, list: [3] }, arr: [{ v: 'b' }, { id: 2 }], extra: null }
  it('replace arrays (default)', () => {
    expect(deepMerge(a, b)).toEqual({ name: 'A', cfg: { x: 2, list: [3], keep: true }, arr: [{ v: 'b' }, { id: 2 }], extra: null })
  })
  it('concat arrays', () => {
    expect((deepMerge(a, b, { arrays: 'concat' }) as typeof a).cfg.list).toEqual([1, 2, 3])
  })
  it('merge arrays by index', () => {
    const r = deepMerge(a, b, { arrays: 'index' }) as typeof a
    expect(r.cfg.list).toEqual([3, 2])
    expect(r.arr).toEqual([{ id: 1, v: 'b' }, { id: 2 }])
  })
  it('skip nulls and does not mutate inputs', () => {
    expect(deepMerge({ a: 1 }, { a: null }, { skipNulls: true })).toEqual({ a: 1 })
    expect(a.cfg.x).toBe(1)
  })
})

describe('compareStructure', () => {
  it('reports only-in-A, only-in-B and type changes', () => {
    const d = compareStructure({ id: 1, name: 'x', tags: ['a'], meta: { v: 1 } }, { id: '1', tags: ['a', 2], meta: { v: 1, w: true } })
    const by = Object.fromEntries(d.entries.map((e) => [e.path, e.kind]))
    expect(by).toMatchObject({ $: 'same', id: 'typeChanged', name: 'onlyA', tags: 'same', 'tags[]': 'typeChanged', 'meta.v': 'same', 'meta.w': 'onlyB' })
    expect(d).toMatchObject({ onlyA: 1, onlyB: 1, typeChanged: 2 })
    expect(formatStructureDiff(d)).toBe('~ id  (number → string)\n- name  (string)\n~ tags[]  (string → number | string)\n+ meta.w  (boolean)')
  })
  it('runObjectOp compare/merge need the second input', () => {
    const r = runObjectOp({ op: 'compare', text: '{}', options: DEFAULT_OBJECT_OPTIONS })
    expect(!r.ok && r.error.source).toBe('second')
    const m = runObjectOp({ op: 'merge', text: '{"a":1}', text2: '{"b":', options: DEFAULT_OBJECT_OPTIONS })
    expect(!m.ok && m.error).toMatchObject({ source: 'second', line: 1 })
  })
})

describe('runObjectOp', () => {
  it('flatten warns about ambiguous keys', () => {
    const r = runObjectOp({ op: 'flatten', text: '{"a.b":1}', options: DEFAULT_OBJECT_OPTIONS })
    expect(r.ok && r.value.warnings[0]).toMatch(/already contain/)
  })
  it('values as lines', () => {
    const r = runObjectOp({ op: 'values', text: '{"a":"x","b":[1,null,12345678901234567890]}', options: { ...DEFAULT_OBJECT_OPTIONS, valuesFormat: 'lines' } })
    expect(r.ok && r.value.output).toBe('x\n1\nnull\n12345678901234567890')
  })
  it('reports document parse errors with location', () => {
    const r = runObjectOp({ op: 'sort', text: '{\n"a": tru}', options: DEFAULT_OBJECT_OPTIONS })
    expect(!r.ok && r.error.line).toBe(2)
  })
})

describe('tool samples', () => {
  it('every operation succeeds on the shipped samples', async () => {
    const { SAMPLE_A, SAMPLE_B, FLAT_SAMPLE } = await import('@/tools/json/object-utils/samples')
    const ops = ['flatten', 'sort', 'removeNulls', 'removeEmpty', 'keys', 'values', 'merge', 'compare'] as const
    for (const op of ops) {
      const r = runObjectOp({ op, text: SAMPLE_A, text2: SAMPLE_B, options: DEFAULT_OBJECT_OPTIONS })
      expect(r.ok, op).toBe(true)
    }
    const u = runObjectOp({ op: 'unflatten', text: FLAT_SAMPLE, options: DEFAULT_OBJECT_OPTIONS })
    expect(u.ok && JSON.parse(u.value.output).database.replicas[1].host).toBe('db-replica-2.internal')
    // The 2^53+1 limit survives flattening untouched
    const f = runObjectOp({ op: 'flatten', text: SAMPLE_A, options: DEFAULT_OBJECT_OPTIONS })
    expect(f.ok && f.value.output).toContain('"limits.max_order_value": 9007199254740993')
    const m = runObjectOp({ op: 'merge', text: SAMPLE_A, text2: SAMPLE_B, options: { ...DEFAULT_OBJECT_OPTIONS, mergeArrays: 'index' } })
    expect(m.ok && JSON.parse(m.value.output).database.replicas[1]).toEqual({ host: 'db-replica-3.prod', port: 5432, lag_alert_ms: 1000 })
  })
})
