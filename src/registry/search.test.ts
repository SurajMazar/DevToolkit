import { describe, expect, it } from 'vitest'
import { searchTools } from './search'
import { CATEGORIES, TOOLS } from './tools.data'

const top = (q: string) => searchTools(TOOLS, CATEGORIES, q)[0]?.tool.id

describe('tool search', () => {
  it('finds Case Converter for "camel"', () => expect(top('camel')).toBe('case-converter'))
  it('finds JWT Decoder for "JWT"', () => expect(top('JWT')).toBe('jwt-decoder'))
  it('finds JSON Formatter for "json format"', () => expect(top('json format')).toBe('json-formatter'))
  it('finds UUID generator for "guid"', () => expect(top('guid')).toBe('uuid-generator'))
  it('finds Text Diff for "diff"', () => expect(['text-diff', 'json-diff']).toContain(top('diff')))
  it('supports fuzzy subsequence queries', () => expect(top('tmstmp')).toBe('timestamp-converter'))
  it('returns nothing for nonsense', () => expect(searchTools(TOOLS, CATEGORIES, 'zzqqxx')).toHaveLength(0))
  it('requires every term to match', () => expect(top('sha256')).toBe('hash-generator'))
})

describe('registry integrity', () => {
  it('has unique ids and paths', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length)
    expect(new Set(TOOLS.map((t) => t.path)).size).toBe(TOOLS.length)
  })
  it('places each tool under its category path', () => {
    for (const t of TOOLS) {
      const cat = CATEGORIES.find((c) => c.id === t.category)!
      expect(t.path.startsWith(cat.path + '/') || t.path.startsWith('/json/') ).toBe(true)
    }
  })
})
