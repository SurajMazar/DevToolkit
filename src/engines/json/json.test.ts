import { describe, expect, it } from 'vitest'
import { parseJson, isLosslessNumber, jsonTypeOf } from './parse'
import { stringifyJson } from './stringify'

describe('parseJson', () => {
  it('parses valid JSON', () => {
    const r = parseJson('{"a": [1, true, null, "x"]}')
    expect(r.ok && r.value).toEqual({ a: [1, true, null, 'x'] })
  })
  it('reports line and column of errors', () => {
    const r = parseJson('{\n  "a": 1,\n  "b": tru\n}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.line).toBe(3)
      expect(r.error.column).toBe(8)
    }
  })
  it('reports trailing commas', () => {
    const r = parseJson('[1, 2,]')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.line).toBe(1)
  })
  it('reports unexpected end', () => {
    const r = parseJson('{"a": ')
    expect(r.ok).toBe(false)
  })
  it('rejects empty input', () => expect(parseJson('   ').ok).toBe(false))
  it('strips BOM', () => expect(parseJson('﻿{"a":1}').ok).toBe(true))
  it('preserves big integers exactly', () => {
    const r = parseJson('{"id": 12345678901234567890, "small": 42}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const v = r.value as { id: unknown; small: number }
      expect(isLosslessNumber(v.id)).toBe(true)
      expect(v.small).toBe(42)
      expect(r.hasBigNumbers).toBe(true)
      expect(stringifyJson(r.value)).toBe('{"id":12345678901234567890,"small":42}')
    }
  })
  it('preserves high-precision decimals', () => {
    const r = parseJson('[0.10000000000000000555, 1.5]')
    expect(r.ok && stringifyJson(r.value)).toBe('[0.10000000000000000555,1.5]')
  })
  it('ignores long digit runs inside strings', () => {
    const r = parseJson('{"id": "12345678901234567890", "n": 1}')
    expect(r.ok && r.hasBigNumbers).toBe(false)
  })
  it('detects huge exponents', () => {
    const r = parseJson('[1e400]')
    expect(r.ok && stringifyJson(r.value)).toBe('[1e400]')
  })
  it('types', () => {
    expect(jsonTypeOf([])).toBe('array')
    expect(jsonTypeOf(null)).toBe('null')
    expect(jsonTypeOf({ isLosslessNumber: true, value: '1' })).toBe('number')
  })
})

describe('stringifyJson', () => {
  const v = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'é' } }
  it('matches JSON.stringify formatting', () => {
    expect(stringifyJson(v, { indent: 2 })).toBe(JSON.stringify(v, null, 2))
    expect(stringifyJson(v)).toBe(JSON.stringify(v))
    expect(stringifyJson(v, { indent: '\t' })).toBe(JSON.stringify(v, null, '\t'))
  })
  it('sorts keys deeply', () => {
    expect(stringifyJson(v, { sortKeys: true })).toBe('{"a":{"c":"é","d":[1,{"y":2,"z":1}]},"b":1}')
    expect(stringifyJson({ a: 1, b: 2 }, { sortKeys: 'desc' })).toBe('{"b":2,"a":1}')
  })
  it('escapes non-ascii when asked', () => expect(stringifyJson('é✓', { asciiOnly: true })).toBe('"\\u00e9\\u2713"'))
  it('handles empty containers', () => expect(stringifyJson({ a: [], b: {} }, { indent: 2 })).toBe(JSON.stringify({ a: [], b: {} }, null, 2)))
  it('throws on cycles', () => {
    const o: Record<string, unknown> = {}
    o.self = o
    expect(() => stringifyJson(o)).toThrow(/circular/)
  })
  it('JS fallback matches the native path', async () => {
    const { stringifyJsonJs } = await import('./stringify')
    const r = parseJson('{"z": [1, {"b": 12345678901234567890, "a": "é"}], "y": null}')
    if (!r.ok) throw new Error()
    for (const o of [{}, { indent: 2 }, { indent: '\t', sortKeys: true as const }, { asciiOnly: true }, { sortKeys: 'desc' as const }]) expect(stringifyJsonJs(r.value, o)).toBe(stringifyJson(r.value, o))
  })
  it('handles a large document', () => {
    const big = Array.from({ length: 50_000 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b'], nested: { ok: true } }))
    const text = stringifyJson(big, { indent: 2 })
    expect(text).toBe(JSON.stringify(big, null, 2))
  })
})
