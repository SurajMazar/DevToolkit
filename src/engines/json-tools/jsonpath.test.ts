import { describe, expect, it } from 'vitest'
import { parseJson } from '@/engines/json/parse'
import { checkJsonPathSyntax, JsonPathSyntaxError, listAllPaths, previewValue, queryJsonPath } from './jsonpath'
import { runJsonPath } from './tasks'
import { PATH_EXAMPLES, PATH_SAMPLE } from '@/tools/json/path/sample'

const store = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
      { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', isbn: '0-395-19395-8', price: 22.99 },
    ],
    bicycle: { color: 'red', price: 19.95 },
    'odd key': { 'a/b': 1, "it's": 2 },
  },
}

describe('queryJsonPath', () => {
  it('basic child, wildcard and recursive descent', () => {
    expect(queryJsonPath(store, '$.store.book[*].author').matches.map((m) => m.value)).toEqual(['Nigel Rees', 'Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien'])
    expect(queryJsonPath(store, '$..price').total).toBe(5)
    expect(queryJsonPath(store, '$..book[-1:]').matches[0].path).toBe('$.store.book[3]')
  })
  it('filters run with the safe evaluator (no native eval)', () => {
    const r = queryJsonPath(store, '$..[?(@.price < 10)]')
    expect(r.matches.map((m) => m.value)).toEqual([store.store.book[0], store.store.book[2]])
    expect(r.matches[0].path).toBe('$.store.book[0]')
    expect(r.matches[0].pointer).toBe('/store/book/0')
    expect(queryJsonPath(store, "$..book[?(@.category == 'fiction' && @.price > 10)].title").matches.map((m) => m.value)).toEqual(['Sword of Honour', 'The Lord of the Rings'])
    expect(queryJsonPath(store, '$..book[?(@.isbn)].title').total).toBe(2)
  })
  it('refuses code execution in filters', () => {
    expect(() => queryJsonPath(store, "$..[?(constructor.constructor('return 1')())]")).toThrow(JsonPathSyntaxError)
    expect(() => queryJsonPath(store, '$..[?(globalThis.alert)]')).toThrow()
  })
  it('normalizes paths with special keys', () => {
    const r = queryJsonPath(store, "$.store['odd key'].*")
    expect(r.matches.map((m) => m.path)).toEqual(['$.store["odd key"]["a/b"]', '$.store["odd key"]["it\'s"]'])
    expect(r.matches[0].pointer).toBe('/store/odd key/a~1b')
  })
  it('keeps big numbers exact in results and filters', () => {
    const p = parseJson('{"ids":[{"id":12345678901234567890,"n":1},{"id":2,"n":2}]}')
    if (!p.ok) throw new Error()
    const r = queryJsonPath(p.value, '$.ids[?(@.id > 100)].id', { hasBigNumbers: true })
    expect(r.total).toBe(1)
    expect(previewValue(r.matches[0].value)).toBe('12345678901234567890')
  })
  it('property names with ~', () => {
    const r = queryJsonPath(store, '$.store.*~')
    expect(r.matches.map((m) => m.value)).toEqual(['book', 'bicycle', 'odd key'])
  })
  it('empty results and the root', () => {
    expect(queryJsonPath(store, '$.nope').total).toBe(0)
    expect(queryJsonPath(store, '$').matches[0].path).toBe('$')
  })
  it('caps very large result sets explicitly', () => {
    const arr = Array.from({ length: 2000 }, (_, i) => i)
    const r = queryJsonPath(arr, '$[*]', { limit: 100 })
    expect(r.matches.length).toBe(100)
    expect(r.total).toBe(2000)
    expect(r.capped).toBe(true)
  })
})

describe('checkJsonPathSyntax', () => {
  const bad = (e: string) => {
    try {
      checkJsonPathSyntax(e)
    } catch (err) {
      return err as JsonPathSyntaxError
    }
    return null
  }
  it('reports malformed queries with a column', () => {
    expect(bad('')!.message).toMatch(/Enter/)
    expect(bad('store.book')!.message).toMatch(/starts with \$/)
    expect(bad('$.store[')).toMatchObject({ column: 8 })
    expect(bad('$.a]')!.message).toMatch(/Unexpected "\]"/)
    expect(bad('$.a[]')!.message).toMatch(/Empty brackets/)
    expect(bad("$['abc]")!.message).toMatch(/Unterminated string/)
    expect(bad('$.a.')!.message).toMatch(/ends with/)
    expect(bad('$...a')!.message).toMatch(/Too many dots/)
    expect(bad('$..[?(@.a < 1)')!.message).toMatch(/Unclosed "\["/)
  })
  it('accepts valid queries including regex and quoted brackets', () => {
    expect(bad('$..book[?(@.title.match(/of [a-z]+/i))]')).toBeNull()
    expect(bad("$['a]b']")).toBeNull()
    expect(bad('$..*')).toBeNull()
    expect(bad('$.a[1:3]')).toBeNull()
    expect(bad('$..[?(@.price / 2 > 3)]')).toBeNull()
  })
  it('runJsonPath separates document and query errors', () => {
    const d = runJsonPath({ text: '{"a":', expr: '$.a' })
    expect(!d.ok && d.error.source).toBe('document')
    const q = runJsonPath({ text: '{"a":1}', expr: '$.a[' })
    expect(!q.ok && q.error.source).toBe('query')
    const q2 = runJsonPath({ text: '{"a":1}', expr: '$..[?(@.a <)]' })
    expect(!q2.ok && q2.error.message).toMatch(/Expected expression/)
  })
})

describe('listAllPaths', () => {
  it('lists every location in order with previews', () => {
    const r = listAllPaths({ a: [1, { 'b c': null }], 'ü': 'x'.repeat(100) })
    expect(r.paths.map((p) => p.path)).toEqual(['$.a', '$.a[0]', '$.a[1]', '$.a[1]["b c"]', '$["ü"]'])
    expect(r.paths[0]).toMatchObject({ type: 'array', preview: '[2]', depth: 1 })
    expect(r.paths[4].preview.length).toBe(60)
    expect(r.paths[4].preview.endsWith('…')).toBe(true)
  })
  it('caps and reports totals', () => {
    const r = listAllPaths(Array.from({ length: 30 }, () => ({ x: 1 })), 10)
    expect(r.total).toBe(60)
    expect(r.paths.length).toBe(10)
    expect(r.capped).toBe(true)
  })
})

describe('cheat-sheet examples', () => {
  it.each(PATH_EXAMPLES.map((e) => [e.expr]))('%s returns results on the sample', (expr) => {
    const r = runJsonPath({ text: PATH_SAMPLE, expr })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.total).toBeGreaterThan(0)
  })
})
