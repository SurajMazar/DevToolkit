import { describe, expect, it } from 'vitest'
import { DEFAULT_JSON_TO_CSV as D, findArrayCandidates, flattenRecord, formatPath, jsonToCsv, type JsonToCsvOptions, type JsonToCsvResult } from './json-to-csv'
import { readCsv } from './csv'

function run(json: unknown, opts: Partial<JsonToCsvOptions> = {}): JsonToCsvResult {
  const r = jsonToCsv(typeof json === 'string' ? json : JSON.stringify(json), { ...D, ...opts })
  if (!r.ok) throw new Error(r.error.message)
  return r
}

describe('record source', () => {
  it('uses a root array of objects', () => {
    const r = run([{ a: 1, b: 'x' }, { a: 2, b: 'y' }])
    expect(r.csv).toBe('a,b\n1,x\n2,y\n')
    expect(r.recordCount).toBe(2)
  })
  it('treats a single object as one row', () => {
    const r = run({ id: 7, name: 'Ada' })
    expect(r.csv).toBe('id,name\n7,Ada\n')
  })
  it('finds an array wrapped in an object', () => {
    const r = run({ meta: { page: 1 }, data: { items: [{ id: 1 }, { id: 2 }] } })
    expect(r.path).toEqual(['data', 'items'])
    expect(r.csv).toBe('id\n1\n2\n')
  })
  it('lists candidates when several arrays exist and lets the caller pick', () => {
    const doc = { users: [{ id: 1 }], orders: [{ total: 5 }, { total: 6 }], tags: ['a'] }
    const c = findArrayCandidates(doc)
    expect(c.map((x) => x.label)).toEqual(['$.users', '$.orders', '$.tags'])
    const r = run(doc, { path: ['orders'] })
    expect(r.csv).toBe('total\n5\n6\n')
  })
  it('warns when the chosen path does not exist', () => {
    const r = run({ a: [{ x: 1 }] }, { path: ['missing'] })
    expect(r.warnings[0]).toMatch(/does not exist/)
  })
  it('handles arrays of primitives and arrays of arrays', () => {
    expect(run([1, 'two', null]).csv).toBe('value\n1\ntwo\n\n')
    expect(run([[1, 2], [3, 4, 5]]).csv).toBe('column_1,column_2,column_3\n1,2,\n3,4,5\n')
  })
  it('formats paths', () => {
    expect(formatPath([])).toBe('$')
    expect(formatPath(['a', 0, 'b c'])).toBe('$.a[0]["b c"]')
  })
})

describe('flattening', () => {
  const rec = { id: 1, user: { name: 'Ada', address: { city: 'London', zip: '02134' } }, tags: ['x', 'y'] }
  it('flattens nested objects with dot keys', () => {
    const r = run([rec])
    expect(r.table.headers).toEqual(['id', 'user.name', 'user.address.city', 'user.address.zip', 'tags'])
    expect(r.table.rows[0]).toEqual(['1', 'Ada', 'London', '02134', 'x; y'])
  })
  it('custom separator and max depth', () => {
    const r = run([rec], { separator: '_', maxDepth: 1 })
    expect(r.table.headers).toEqual(['id', 'user_name', 'user_address', 'tags'])
    expect(r.table.rows[0][2]).toBe('{"city":"London","zip":"02134"}')
  })
  it('flatten off JSON-encodes objects', () => {
    const r = run([rec], { flatten: false })
    expect(r.table.headers).toEqual(['id', 'user', 'tags'])
    expect(r.csv).toContain('"{""name"":""Ada""')
  })
  it('array modes: join, json, expand', () => {
    expect(run([rec], { arrays: 'join', joinWith: '|' }).table.rows[0][4]).toBe('x|y')
    expect(run([rec], { arrays: 'json' }).table.rows[0][4]).toBe('["x","y"]')
    const ex = run([{ tags: ['a', 'b'], items: [{ sku: 'A1', qty: 2 }] }], { arrays: 'expand' })
    expect(ex.table.headers).toEqual(['tags[0]', 'tags[1]', 'items[0].sku', 'items[0].qty'])
  })
  it('expand places later indexed columns next to their siblings', () => {
    const r = run([{ id: 1, tags: ['a'], z: 0 }, { id: 2, tags: ['a', 'b', 'c'], z: 1 }], { arrays: 'expand' })
    expect(r.table.headers).toEqual(['id', 'tags[0]', 'tags[1]', 'tags[2]', 'z'])
  })
  it('join encodes objects inside arrays as JSON', () => {
    expect(run([{ a: [{ x: 1 }, 2] }]).table.rows[0][0]).toBe('{"x":1}; 2')
  })
  it('empty objects/arrays are not lost', () => {
    const r = run([{ a: {}, b: [] }], { arrays: 'json' })
    expect(r.table.rows[0]).toEqual(['{}', '[]'])
  })
  it('keeps colliding flattened keys instead of overwriting', () => {
    const f = flattenRecord({ 'a.b': 1, a: { b: 2 } }, D)
    expect([...f.cells.entries()]).toEqual([
      ['a.b', '1'],
      ['a.b~2', '2'],
    ])
  })
})

describe('columns', () => {
  const data = [{ b: 1, a: 2 }, { c: 3, a: 4 }]
  it('union of keys in first-seen order', () => {
    expect(run(data).table.headers).toEqual(['b', 'a', 'c'])
  })
  it('sorts columns on request', () => {
    expect(run(data, { sortColumns: true }).table.headers).toEqual(['a', 'b', 'c'])
  })
  it('missing vs null representation', () => {
    const r = run([{ a: null, b: 1 }, { b: 2 }], { nullText: 'NULL', missingText: 'N/A' })
    expect(r.csv).toBe('a,b\nNULL,1\nN/A,2\n')
  })
  it('exclude and rename', () => {
    const r = run(data, { columns: { exclude: ['c'], rename: { b: 'Bee' } } })
    expect(r.csv).toBe('Bee,a\n1,2\n,4\n')
    expect(r.columns.find((c) => c.key === 'c')!.included).toBe(false)
  })
  it('warns on duplicate headers after renaming', () => {
    const r = run(data, { columns: { exclude: [], rename: { b: 'a' } } })
    expect(r.warnings.join()).toMatch(/Duplicate header/)
  })
  it('reports presence and value kinds per column', () => {
    const r = run([{ a: 1, b: 'x' }, { a: 'y' }])
    expect(r.columns[0]).toMatchObject({ key: 'a', present: 2 })
    expect(r.columns[0].kinds.sort()).toEqual(['number', 'string'])
    expect(r.columns[1].present).toBe(1)
  })
})

describe('output format', () => {
  it('delimiter, quote-all, CRLF, no header', () => {
    const r = run([{ a: 'x;y', b: 1 }], { delimiter: ';', quote: 'all', lineEnding: 'crlf', header: false })
    expect(r.csv).toBe('"x;y";"1"\r\n')
  })
  it('quotes values that need it so the CSV reads back identically', () => {
    const data = [{ t: 'a,b' }, { t: 'say "hi"' }, { t: 'two\nlines' }, { t: ' pad ' }]
    const r = run(data)
    const back = readCsv(r.csv).rows.slice(1).map((x) => x[0])
    expect(back).toEqual(data.map((d) => d.t))
  })
  it('escapes formula-like strings when asked, but not numbers', () => {
    const r = run([{ f: '=SUM(A1)', n: -5, s: '@cmd' }], { escapeFormulas: true })
    expect(r.table.rows[0]).toEqual(["'=SUM(A1)", '-5', "'@cmd"])
  })
  it('preserves big numbers exactly', () => {
    const r = run('[{"id": 12345678901234567890, "f": 0.1000000000000000055511}]')
    expect(r.table.rows[0]).toEqual(['12345678901234567890', '0.1000000000000000055511'])
  })
  it('booleans, unicode keys and values', () => {
    expect(run([{ 'café': true, 東京: '👩‍💻' }]).csv).toBe('café,東京\ntrue,👩‍💻\n')
  })
})

describe('errors', () => {
  it('reports JSON syntax errors with location', () => {
    const r = jsonToCsv('[{"a": 1,}]', D)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.line).toBe(1)
  })
  it('rejects an empty delimiter', () => {
    expect(jsonToCsv('[]', { ...D, delimiter: '' }).ok).toBe(false)
  })
  it('empty array gives empty CSV', () => {
    expect(run([]).csv).toBe('')
  })
})

describe('large input', () => {
  it('converts 20k nested records', () => {
    const data = Array.from({ length: 20_000 }, (_, i) => ({ id: i, user: { name: `u${i}`, score: i / 2 }, tags: ['a', 'b'] }))
    const t0 = performance.now()
    const r = run(data)
    expect(performance.now() - t0).toBeLessThan(3000)
    expect(r.table.rows.length).toBe(20_000)
    expect(r.table.headers).toEqual(['id', 'user.name', 'user.score', 'tags'])
    expect(r.csv.split('\n')[20_000]).toBe('19999,u19999,9999.5,a; b')
  })
})
