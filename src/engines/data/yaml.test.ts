import { describe, expect, it } from 'vitest'
import { DEFAULT_JSON_TO_YAML as JY, DEFAULT_YAML_TO_JSON as YJ, isAmbiguousString, jsonToYaml, yamlToJson, type JsonToYamlOptions, type YamlToJsonOptions } from './yaml'

const y2j = (s: string, o: Partial<YamlToJsonOptions> = {}) => yamlToJson(s, { ...YJ, ...o })
const j2y = (v: unknown, o: Partial<JsonToYamlOptions> = {}) => jsonToYaml(typeof v === 'string' ? v : JSON.stringify(v), { ...JY, ...o })

describe('YAML → JSON', () => {
  it('converts a typical config', () => {
    const r = y2j('name: api\nreplicas: 3\nports:\n  - 80\n  - 443\nenv:\n  DEBUG: false\n  RATIO: 0.5\nempty:\n')
    expect(r.error).toBeUndefined()
    expect(JSON.parse(r.output)).toEqual({ name: 'api', replicas: 3, ports: [80, 443], env: { DEBUG: false, RATIO: 0.5 }, empty: null })
  })
  it('preserves 64-bit integers and over-precise decimals', () => {
    const r = y2j('id: 12345678901234567890\nneg: -9223372036854775808\nsafe: 9007199254740991\nf: 0.1000000000000000055511\n')
    expect(r.output).toBe('{\n  "id": 12345678901234567890,\n  "neg": -9223372036854775808,\n  "safe": 9007199254740991,\n  "f": 0.1000000000000000055511\n}')
  })
  it('big hex integers keep their exact value', () => {
    expect(y2j('h: 0xFFFFFFFFFFFFFFFF').output).toContain('"h": 18446744073709551615')
  })
  it('YAML 1.2 keeps yes/no/on/off as strings; 1.1 makes them booleans', () => {
    const src = 'a: yes\nb: no\nc: on\nd: off\ne: 0777\nf: 1:20\n'
    expect(JSON.parse(y2j(src).output)).toEqual({ a: 'yes', b: 'no', c: 'on', d: 'off', e: 777, f: '1:20' })
    expect(JSON.parse(y2j(src, { version: '1.1' }).output)).toEqual({ a: true, b: false, c: true, d: false, e: 511, f: 80 })
  })
  it('1.1 timestamps become ISO strings with a warning', () => {
    const r = y2j('d: 2001-12-14\n', { version: '1.1' })
    expect(JSON.parse(r.output)).toEqual({ d: '2001-12-14T00:00:00.000Z' })
    expect(r.warnings.map((w) => w.message).join()).toMatch(/timestamp/)
  })
  it('multi-document input → array, or first document with a warning', () => {
    const src = 'a: 1\n---\na: 2\n'
    expect(JSON.parse(y2j(src).output)).toEqual([{ a: 1 }, { a: 2 }])
    const first = y2j(src, { multiDoc: 'first' })
    expect(JSON.parse(first.output)).toEqual({ a: 1 })
    expect(first.warnings[0].message).toMatch(/2 documents/)
  })
  it('resolves anchors, aliases and merge keys, and warns', () => {
    const r = y2j('base: &b {x: 1, y: 2}\nuse: *b\nmerged:\n  <<: *b\n  y: 3\n')
    expect(JSON.parse(r.output)).toEqual({ base: { x: 1, y: 2 }, use: { x: 1, y: 2 }, merged: { x: 1, y: 3 } })
    expect(r.warnings.map((w) => w.message).join()).toMatch(/alias/)
  })
  it('merge keys can be disabled in 1.2', () => {
    expect(JSON.parse(y2j('a: &a {x: 1}\nb:\n  <<: *a\n', { merge: false }).output).b).toEqual({ '<<': { x: 1 } })
  })
  it('warns about comments, custom tags, non-string keys and .inf', () => {
    const r = y2j('# top\nref: !Ref MyBucket\n1: one\nbig: .inf\n? [a, b]\n: complex\n')
    const all = r.warnings.map((w) => w.message).join('\n')
    expect(all).toMatch(/Comments are dropped/)
    expect(all).toMatch(/custom tag/)
    expect(all).toMatch(/non-string key/)
    expect(all).toMatch(/\.inf/)
    expect(all).toMatch(/collection key/)
    expect(JSON.parse(r.output)).toMatchObject({ ref: 'MyBucket', '1': 'one', big: null })
  })
  it('reports syntax errors with line and column', () => {
    const r = y2j('a: 1\nb: [1, 2\nc: 3\n')
    expect(r.error).toBeDefined()
    expect(r.error!.line).toBeGreaterThanOrEqual(2)
    expect(r.error!.column).toBeGreaterThan(0)
    expect(r.error!.message).not.toContain('\n')
  })
  it('reports duplicate keys', () => {
    const r = y2j('a: 1\na: 2\n')
    expect(r.error?.message).toMatch(/unique/i)
    expect(r.error?.line).toBe(2)
  })
  it('bad indentation is an error, not a silent guess', () => {
    expect(y2j('a:\n  b: 1\n c: 2\n').error).toBeDefined()
  })
  it('sort keys and indentation', () => {
    expect(y2j('b: 1\na: 2', { sortKeys: true, indent: 0 }).output).toBe('{"a":2,"b":1}')
  })
  it('comment-only input gives null', () => {
    expect(y2j('# nothing here\n').output).toBe('null')
  })
  it('unicode and block scalars', () => {
    expect(JSON.parse(y2j('emoji: 👩‍💻\ntext: |\n  line 1\n  line 2\n').output)).toEqual({ emoji: '👩‍💻', text: 'line 1\nline 2\n' })
  })
})

describe('JSON → YAML', () => {
  it('converts objects and arrays', () => {
    expect(j2y({ name: 'api', ports: [80, 443], env: { DEBUG: false } }).output).toBe('name: api\nports:\n  - 80\n  - 443\nenv:\n  DEBUG: false\n')
  })
  it('keeps LosslessNumber digits', () => {
    const r = j2y('{"id": 12345678901234567890, "f": 0.1000000000000000055511, "n": 1}')
    expect(r.output).toBe('id: 12345678901234567890\nf: 0.1000000000000000055511\nn: 1\n')
  })
  it('writes numbers exactly as they appear in the JSON', () => {
    expect(j2y('{"price": 89.00, "e": 1E5, "neg": -0.50}').output).toBe('price: 89.00\ne: 1E5\nneg: -0.50\n')
    expect(JSON.parse(yamlToJson('price: 89.00\ne: 1E5\n', YJ).output)).toEqual({ price: 89, e: 100000 })
  })
  it('big numbers survive a full JSON → YAML → JSON round trip', () => {
    const json = '{\n  "id": 12345678901234567890,\n  "list": [\n    -9223372036854775808,\n    1.5\n  ]\n}'
    expect(yamlToJson(j2y(json).output, YJ).output).toBe(json)
  })
  it('quotes strings that YAML 1.1 or 1.2 would read as other types', () => {
    const r = j2y({ a: 'yes', b: 'on', c: '0o17', d: '1:20', e: '012', f: 'null', g: 'true', h: 'hello', i: '123' })
    expect(r.output).toBe('a: "yes"\nb: "on"\nc: "0o17"\nd: "1:20"\ne: "012"\nf: "null"\ng: "true"\nh: hello\ni: "123"\n')
    expect(isAmbiguousString('off')).toBe(true)
    expect(isAmbiguousString('offset')).toBe(false)
  })
  it('without ambiguity quoting, 1.2 output leaves yes plain', () => {
    expect(j2y({ a: 'yes' }, { quoteAmbiguous: false }).output).toBe('a: yes\n')
    expect(j2y({ a: 'yes' }, { quoteAmbiguous: false, version: '1.1' }).output).toBe('a: "yes"\n')
  })
  it('string styles, indent, sort keys and indentSeq', () => {
    expect(j2y({ b: 'x', a: [1] }, { stringStyle: 'single', sortKeys: true }).output).toBe("a:\n  - 1\nb: 'x'\n")
    expect(j2y({ a: 'x' }, { stringStyle: 'double' }).output).toBe('a: "x"\n')
    expect(j2y({ a: { b: [1] } }, { indent: 2, indentSeq: false }).output).toBe('a:\n  b:\n  - 1\n')
    expect(j2y({ a: { b: 1 } }, { indent: 4 }).output).toBe('a:\n    b: 1\n')
    expect(j2y({ y: 'n', on: 'x' }).output).toBe('y: "n"\non: x\n')
  })
  it('line width wraps long strings or never wraps', () => {
    const long = 'word '.repeat(40).trim()
    expect(j2y({ t: long }, { lineWidth: 0 }).output.split('\n').length).toBe(2)
    expect(j2y({ t: long }, { lineWidth: 60 }).output.split('\n').length).toBeGreaterThan(2)
  })
  it('top-level array as multiple documents', () => {
    expect(j2y([{ a: 1 }, { a: 2 }], { arrayAsDocuments: true }).output).toBe('---\na: 1\n---\na: 2\n')
  })
  it('multi-line strings use block scalars and round-trip', () => {
    const v = { script: 'echo one\necho two\n', key: 'tab\there', quote: 'it\'s "fine"', empty: '', unicode: 'café 東京' }
    const y = j2y(v).output
    expect(y).toContain('script: |')
    expect(JSON.parse(yamlToJson(y, YJ).output)).toEqual(v)
  })
  it('reports JSON errors with location', () => {
    const r = j2y('{"a": }')
    expect(r.error?.line).toBe(1)
    expect(r.error?.column).toBeGreaterThan(1)
  })
  it('scalars and empty containers', () => {
    expect(j2y('null').output).toBe('null\n')
    expect(j2y('[]').output).toBe('[]\n')
    expect(j2y('{}').output).toBe('{}\n')
  })
})

describe('large input', () => {
  it('round-trips 10k records', () => {
    const data = Array.from({ length: 10_000 }, (_, i) => ({ id: i, name: `n${i}`, tags: ['a', 'yes'], nested: { ok: i % 2 === 0 } }))
    const y = j2y(data).output
    const back = JSON.parse(yamlToJson(y, YJ).output)
    expect(back).toEqual(data)
  })
})
