import { describe, expect, it } from 'vitest'
import { analyzeResponse, childPath, compareJson, computeArrayStats, computeOverview, inferShape, listPaths, parseResponse, searchJson, splitHttpResponse, type ShapeNode } from './api-inspect'
import { parseJson } from '@/engines/json/parse'

const doc = {
  data: [
    { id: 1, name: 'Ada', email: 'ada@example.com', role: 'admin', score: 9.5, tags: ['a', 'b'] },
    { id: 2, name: 'Linus', role: 'user', score: 7, tags: [] },
    { id: 3, name: 'Grace', email: null, role: 'user', score: 8, tags: ['c'] },
  ],
  meta: { page: 1, total: 3, 'next-page': null },
}

const find = (n: ShapeNode, path: string): ShapeNode | undefined => (n.path === path ? n : n.children?.map((c) => find(c, path)).find(Boolean))

describe('splitHttpResponse', () => {
  it('passes plain JSON through', () => {
    expect(splitHttpResponse('{"a":1}')).toMatchObject({ body: '{"a":1}', statusLines: [], headers: [] })
  })
  it('strips a status line and headers', () => {
    const raw = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Request-Id: abc\r\n\r\n{"ok":true}'
    const e = splitHttpResponse(raw)
    expect(e.statusLines).toEqual(['HTTP/1.1 200 OK'])
    expect(e.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Request-Id', value: 'abc' }])
    expect(e.body).toBe('{"ok":true}')
    expect(e.bodyLineOffset).toBe(4)
  })
  it('skips interim 100 Continue responses and HTTP/2 status', () => {
    const e = splitHttpResponse('HTTP/1.1 100 Continue\n\nHTTP/2 201\ncontent-type: application/json\n\n[1]')
    expect(e.statusLines).toEqual(['HTTP/1.1 100 Continue', 'HTTP/2 201'])
    expect(e.body).toBe('[1]')
  })
  it('accepts headers without a status line', () => {
    expect(splitHttpResponse('content-type: application/json\ncache-control: no-store\n\n{}').body).toBe('{}')
  })
  it('does not strip non-header text', () => {
    expect(splitHttpResponse('hello world\n\n{}').body).toBe('hello world\n\n{}')
  })
})

describe('parseResponse', () => {
  it('maps error lines back to the original text', () => {
    const r = parseResponse('HTTP/1.1 200 OK\nA: b\n\n{\n  "x": ,\n}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.line).toBe(5)
  })
})

describe('overview', () => {
  it('counts nodes, keys, types and depth', () => {
    const o = computeOverview(doc)
    expect(o.counts).toEqual({ object: 5, array: 4, string: 10, number: 8, boolean: 0, null: 2 })
    expect(o.depth).toBe(5)
    expect(o.totalKeys).toBe(2 + 6 + 5 + 6 + 3)
    expect(o.maxArrayLength).toBe(3)
    expect(o.emptyContainers).toBe(1)
  })
  it('handles primitives and big numbers', () => {
    const p = parseJson('{"id": 12345678901234567890}')
    expect(p.ok && computeOverview(p.value).counts.number).toBe(1)
    expect(computeOverview('x').nodes).toBe(1)
  })
})

describe('inferShape', () => {
  it('merges array items and tracks optional fields', () => {
    const s = inferShape(doc)
    const email = find(s, '$.data[*].email')!
    expect(email.required).toBe(false)
    expect(email.presentIn).toBe(2)
    expect(email.parentCount).toBe(3)
    expect(email.types).toEqual({ string: 1, null: 1 })
    expect(find(s, '$.data[*].id')!.required).toBe(true)
    expect(find(s, '$.data[*].score')!.examples).toEqual(['9.5', '7', '8'])
    expect(find(s, "$.meta['next-page']")).toBeTruthy()
    expect(find(s, '$.data[*].tags[*]')!.types).toEqual({ string: 3 })
  })
  it('caps very wide objects', () => {
    const wide = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, i]))
    expect(inferShape(wide).truncatedKeys).toBe(600)
  })
})

describe('array stats', () => {
  it('computes per-field presence, numeric stats, distinct and top values', () => {
    const stats = computeArrayStats(doc)
    const data = stats.find((s) => s.path === '$.data')!
    expect(data).toMatchObject({ arrays: 1, minLength: 3, maxLength: 3, totalItems: 3, itemTypes: { object: 3 } })
    const score = data.fields.find((f) => f.key === 'score')!
    expect(score.numeric).toEqual({ min: 7, max: 9.5, mean: (9.5 + 7 + 8) / 3, count: 3 })
    const role = data.fields.find((f) => f.key === 'role')!
    expect(role.top).toEqual([{ value: 'user', count: 2 }, { value: 'admin', count: 1 }])
    expect(role.distinct).toBe(2)
    const email = data.fields.find((f) => f.key === 'email')!
    expect(email.presence).toBeCloseTo(2 / 3)
    expect(email.nulls).toBe(1)
    const tags = stats.find((s) => s.path === '$.data[*].tags')!
    expect(tags).toMatchObject({ arrays: 3, minLength: 0, maxLength: 2, totalItems: 3 })
    expect(tags.values!.distinct).toBe(3)
  })
  it('flags numeric stats over unsafe integers as approximate', () => {
    const p = parseJson('{"a":[{"id":9007199254740993},{"id":9007199254740995}]}')
    const s = p.ok ? computeArrayStats(p.value) : []
    expect(s[0].fields[0].numeric!.approx).toBe(true)
    expect(computeArrayStats({ a: [{ x: 1 }] })[0].fields[0].numeric!.approx).toBeUndefined()
  })
  it('handles a large array quickly', () => {
    const big = { items: Array.from({ length: 50_000 }, (_, i) => ({ id: i, status: i % 3 ? 'ok' : 'fail', v: i % 100 })) }
    const t = performance.now()
    const s = computeArrayStats(big)
    expect(performance.now() - t).toBeLessThan(8000)
    expect(s[0].fields.find((f) => f.key === 'status')!.top![0]).toEqual({ value: 'ok', count: 33_333 })
    expect(s[0].fields.find((f) => f.key === 'id')!.distinctCapped).toBe(true)
  })
})

describe('paths and search', () => {
  it('builds JSONPath-style paths with quoting', () => {
    expect(childPath('$', 'a')).toBe('$.a')
    expect(childPath('$', 'a b')).toBe("$['a b']")
    expect(childPath('$', "it's")).toBe("$['it\\'s']")
    expect(childPath('$.x', 3)).toBe('$.x[3]')
  })
  it('lists all, leaf-only and normalised paths in document order', () => {
    expect(listPaths({ a: { b: 1 }, c: [1, 2] }).paths.map((p) => p.path)).toEqual(['$', '$.a', '$.a.b', '$.c', '$.c[0]', '$.c[1]'])
    expect(listPaths({ a: { b: 1 }, c: [] }, { leafOnly: true }).paths.map((p) => p.path)).toEqual(['$.a.b', '$.c'])
    expect(listPaths(doc, { normalized: true, leafOnly: true }).paths.map((p) => p.path)).toContain('$.data[*].email')
  })
  it('searches keys and values with paths', () => {
    const r = searchJson(doc, 'ada')
    expect(r.hits.map((h) => [h.path, h.in])).toEqual([
      ['$.data[0].name', 'value'],
      ['$.data[0].email', 'value'],
    ])
    expect(searchJson(doc, 'EMAIL', { values: false }).total).toBe(2)
    expect(searchJson(doc, 'EMAIL', { values: false, caseSensitive: true }).total).toBe(0)
    expect(searchJson(doc, '7', { exact: true }).hits[0].path).toBe('$.data[1].score')
    expect(searchJson(doc, '').total).toBe(0)
  })
})

describe('compareJson', () => {
  it('reports added, removed, type and value changes at the top-most path', () => {
    const a = { id: 1, name: 'x', items: [{ q: 1 }], old: { deep: true }, n: '5' }
    const b = { id: 2, name: 'x', items: [{ q: 1 }, { q: 2 }], fresh: { deep: 1 }, n: 5 }
    const r = compareJson(a, b)
    expect(r.counts).toMatchObject({ added: 2, removed: 1, typeChanged: 1, valueChanged: 1 })
    expect(r.added.map((x) => x.path)).toEqual(['$.items[1]', '$.fresh'])
    expect(r.removed.map((x) => x.path)).toEqual(['$.old'])
    expect(r.typeChanged[0]).toEqual({ path: '$.n', from: 'string', to: 'number' })
    expect(r.valueChanged[0]).toMatchObject({ path: '$.id', from: '1', to: '2' })
  })
  it('compares schemas ignoring array indices', () => {
    const r = compareJson({ items: [{ a: 1 }, { a: 2 }] }, { items: [{ a: 'x', b: 1 }] }, 'schema')
    expect(r.counts).toMatchObject({ added: 1, removed: 0, typeChanged: 1, valueChanged: 0 })
    expect(r.typeChanged[0]).toEqual({ path: '$.items[*].a', from: 'number', to: 'string' })
  })
  it('treats identical documents as unchanged', () => {
    expect(compareJson(doc, structuredClone(doc)).counts).toMatchObject({ added: 0, removed: 0, typeChanged: 0, valueChanged: 0 })
  })
})

describe('analyzeResponse', () => {
  it('returns everything for a raw HTTP response', () => {
    const r = analyzeResponse('HTTP/1.1 200 OK\nContent-Type: application/json\n\n' + JSON.stringify(doc))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.envelope?.headers).toHaveLength(1)
      expect(r.rootType).toBe('object')
      expect(r.arrays.length).toBe(2)
    }
  })
  it('returns a located error for invalid JSON', () => {
    const r = analyzeResponse('{"a": tru}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.line).toBe(1)
  })
})
