import { describe, expect, it } from 'vitest'
import { EscapeError, escapeJsonString, expandNestedJson, stringifyAsString, unescapeJsonString, unstringifyNested } from './escape'

describe('escapeJsonString', () => {
  it('escapes quotes, backslashes and control characters', () => {
    expect(escapeJsonString('say "hi"\n\tC:\\path')).toBe('"say \\"hi\\"\\n\\tC:\\\\path"')
    expect(escapeJsonString('a\u0001b')).toBe('"a\\u0001b"')
    expect(escapeJsonString('', { quotes: false })).toBe('')
    expect(escapeJsonString('x', { quotes: false })).toBe('x')
  })
  it('ASCII-only output uses \\u escapes and surrogate pairs', () => {
    expect(escapeJsonString('café 東京 👩‍💻', { asciiOnly: true })).toBe('"caf\\u00e9 \\u6771\\u4eac \\ud83d\\udc69\\u200d\\ud83d\\udcbb"')
    expect(escapeJsonString('café')).toBe('"café"')
  })
  it('escapes lone surrogates and optional slash', () => {
    expect(escapeJsonString('\ud800')).toBe('"\\ud800"')
    expect(escapeJsonString('</script>', { escapeSlash: true })).toBe('"<\\/script>"')
  })
  it('round-trips through JSON.parse', () => {
    const s = 'Line1\r\nLine2 "q" \\ \u2028 😀 \u0000'
    expect(JSON.parse(escapeJsonString(s))).toBe(s)
    expect(JSON.parse(escapeJsonString(s, { asciiOnly: true }))).toBe(s)
  })
})

describe('unescapeJsonString', () => {
  it('accepts quoted and unquoted input', () => {
    expect(unescapeJsonString('"a\\nb"')).toEqual({ text: 'a\nb', quoted: true, warnings: [] })
    expect(unescapeJsonString('a\\nb')).toMatchObject({ text: 'a\nb', quoted: false })
    expect(unescapeJsonString('  "x"  \n').text).toBe('x')
    expect(unescapeJsonString('""').text).toBe('')
    expect(unescapeJsonString('').text).toBe('')
  })
  it('decodes every escape, including surrogate pairs', () => {
    expect(unescapeJsonString('"\\" \\\\ \\/ \\b \\f \\n \\r \\t \\u00e9 \\ud83d\\ude00"').text).toBe('" \\ / \b \f \n \r \t é 😀')
  })
  it('reports invalid escapes with position', () => {
    const at = (s: string) => {
      try {
        unescapeJsonString(s)
      } catch (e) {
        return e as EscapeError
      }
      throw new Error('expected error')
    }
    expect(at('"ab\\xcd"')).toMatchObject({ offset: 3, line: 1, column: 4 })
    expect(at('"ab\\xcd"').message).toMatch(/Invalid escape "\\x"/)
    expect(at('line1\nab\\q')).toMatchObject({ line: 2, column: 3 })
    expect(at('"\\u12G4"').message).toMatch(/Invalid unicode escape/)
    expect(at('"\\u12"').message).toMatch(/4 hex digits/)
    expect(at('abc\\').message).toMatch(/Lone backslash/)
    expect(at('"abc').message).toMatch(/Missing closing quote/)
    expect(at('"abc\\"').message).toMatch(/closing quote is escaped/)
    expect(at('"a"b"').message).toMatch(/Unescaped double quote/)
  })
  it('warns (but keeps) raw control chars, raw quotes and lone surrogates', () => {
    const r = unescapeJsonString('a\tb "c"')
    expect(r.text).toBe('a\tb "c"')
    expect(r.warnings).toHaveLength(2)
    expect(unescapeJsonString('"\\ud800x"').warnings[0]).toMatch(/unpaired surrogate/)
    expect(unescapeJsonString('"\\ude00"').warnings[0]).toMatch(/unpaired surrogate/)
  })
  it('agrees with JSON.parse on a large random string', () => {
    let s = ''
    for (let i = 0; i < 20_000; i++) s += String.fromCharCode(i % 3 === 0 ? (i * 7) % 0xd7ff : 32 + (i % 90))
    const lit = JSON.stringify(s)
    expect(unescapeJsonString(lit).text).toBe(s)
    expect(unescapeJsonString(escapeJsonString(s, { asciiOnly: true })).text).toBe(s)
  })
})

describe('nested JSON', () => {
  it('expands stringified JSON recursively', () => {
    const r = expandNestedJson({ payload: '{"user":"{\\"id\\":1}","list":"[1,2]"}', n: '42', s: 'plain', t: '{not json}' })
    expect(r.value).toEqual({ payload: { user: { id: 1 }, list: [1, 2] }, n: '42', s: 'plain', t: '{not json}' })
    expect(r.expanded).toBe(3)
    expect(r.maxLevel).toBe(2)
  })
  it('unstringifies a quoted string literal of JSON', () => {
    const r = unstringifyNested('"{\\"a\\":1,\\"b\\":\\"[true]\\"}"')
    expect(JSON.parse(r.output)).toEqual({ a: 1, b: [true] })
    expect(r.expanded).toBe(2)
  })
  it('unstringifies a bare escaped body without outer quotes', () => {
    const r = unstringifyNested('{\\"a\\":{\\"b\\":2}}')
    expect(JSON.parse(r.output)).toEqual({ a: { b: 2 } })
  })
  it('keeps big numbers and errors on non-JSON', () => {
    expect(unstringifyNested('{"x":"{\\"id\\":12345678901234567890}"}').output).toContain('12345678901234567890')
    expect(() => unstringifyNested('{"a": }')).toThrow(EscapeError)
    expect(() => unstringifyNested('"just text"')).toThrow(/does not contain JSON/)
  })
  it('stringifyAsString is the inverse', () => {
    const src = '{\n  "a": [1, "x\\"y"],\n  "big": 12345678901234567890\n}'
    const lit = stringifyAsString(src)
    expect(lit).toBe('"{\\"a\\":[1,\\"x\\\\\\"y\\"],\\"big\\":12345678901234567890}"')
    expect(JSON.parse(unstringifyNested(lit).output.replace('12345678901234567890', '1'))).toEqual({ a: [1, 'x"y'], big: 1 })
    expect(stringifyAsString('{"é":1}', { asciiOnly: true, quotes: false })).toBe('{\\"\\u00e9\\":1}')
    expect(() => stringifyAsString('{')).toThrow(EscapeError)
  })
})

describe('tool samples', () => {
  it('each mode sample converts without errors', async () => {
    const { JSON_SAMPLE, LITERAL_SAMPLE, NESTED_SAMPLE, TEXT_SAMPLE } = await import('@/tools/json/escape/samples')
    expect(unescapeJsonString(escapeJsonString(TEXT_SAMPLE)).text).toBe(TEXT_SAMPLE)
    const lit = unescapeJsonString(LITERAL_SAMPLE)
    expect(lit.warnings).toEqual([])
    expect(JSON.parse(lit.text).order.note).toBe('Leave at the door\nRing twice')
    const nested = unstringifyNested(NESTED_SAMPLE)
    expect(nested).toMatchObject({ expanded: 3, levels: 2 })
    expect(JSON.parse(nested.output).body.order.items[0].sku).toBe('KB-75-BRN')
    expect(JSON.parse(JSON.parse(stringifyAsString(JSON_SAMPLE)))).toEqual(JSON.parse(JSON_SAMPLE))
  })
})
