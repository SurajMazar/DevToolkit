import { describe, expect, it } from 'vitest'
import { stripJsonc } from './jsonc'
import { analyzeJson } from './analyze'

describe('stripJsonc', () => {
  it('removes comments and trailing commas, keeps strings intact', () => {
    const src = `{
  // line comment
  "url": "http://example.com/*not a comment*/", /* block */
  "list": [1, 2, 3,],
  "obj": { "a": "x,", },
}`
    const r = stripJsonc(src)
    expect(JSON.parse(r.json)).toEqual({ url: 'http://example.com/*not a comment*/', list: [1, 2, 3], obj: { a: 'x,' } })
    expect(r.comments).toBe(2)
    expect(r.trailingCommas).toBe(3)
  })
  it('preserves line positions', () => {
    const src = '{\n/* a\nb */ "x": 1\n}'
    expect(stripJsonc(src).json.split('\n').length).toBe(src.split('\n').length)
  })
  it('handles escaped quotes in strings', () => expect(JSON.parse(stripJsonc('{"a":"say \\"hi\\" // no",}').json)).toEqual({ a: 'say "hi" // no' }))
})

describe('analyzeJson', () => {
  it('counts nodes and depth', () => {
    expect(analyzeJson({ a: [1, 'x', null, { b: true }] })).toEqual({ objects: 2, arrays: 1, strings: 1, numbers: 1, booleans: 1, nulls: 1, keys: 2, maxDepth: 4 })
  })
  it('handles very deep nesting without recursion errors', () => {
    let v: unknown = 1
    for (let i = 0; i < 50_000; i++) v = [v]
    expect(analyzeJson(v).maxDepth).toBe(50_001)
  })
})
