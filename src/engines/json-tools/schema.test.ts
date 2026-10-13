import { describe, expect, it } from 'vitest'
import { parseJson } from '@/engines/json/parse'
import { detectDraft, inferSchema, validateDocument } from './schema'
import { generateSchema, runSchemaValidation } from './tasks'
import { locatePointer } from './locate'

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['id', 'email', 'roles'],
  properties: {
    id: { type: 'integer', minimum: 1 },
    email: { type: 'string', format: 'email' },
    'display name': { type: 'string', maxLength: 5 },
    roles: { type: 'array', items: { enum: ['admin', 'editor', 'viewer'] }, uniqueItems: true },
    address: { $ref: '#/$defs/address' },
  },
  additionalProperties: false,
  $defs: { address: { type: 'object', required: ['city'], properties: { city: { type: 'string' }, zip: { type: 'string', pattern: '^\\d{5}$' } } } },
}

describe('validateDocument', () => {
  it('accepts a valid document', () => {
    const r = validateDocument({ id: 1, email: 'a@b.co', roles: ['admin'], address: { city: 'Oslo', zip: '12345' } }, schema)
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.draft).toBe('2020-12')
  })
  it('reports leaf errors with instance pointers and schema paths', () => {
    const r = validateDocument({ id: 0, email: 'nope', 'display name': 'Too long name', roles: ['admin', 'root', 'admin'], address: { zip: 'abc' }, extra: 1 }, schema)
    expect(r.valid).toBe(false)
    const leaf = r.errors.filter((e) => !e.summary)
    const byPointer = (p: string) => leaf.filter((e) => e.pointer === p).map((e) => e.keyword)
    expect(byPointer('/id')).toContain('minimum')
    expect(byPointer('/email')).toContain('format')
    expect(byPointer('/display name')).toContain('maxLength')
    expect(byPointer('/roles/1')).toContain('enum')
    expect(byPointer('/roles')).toContain('uniqueItems')
    expect(byPointer('/address')).toContain('required')
    expect(byPointer('/address/zip')).toContain('pattern')
    expect(byPointer('/extra')).toEqual(['additionalProperties'])
    expect(leaf.find((e) => e.pointer === '/extra')!.message).toBe('Property "extra" is not allowed (additionalProperties: false)')
    expect(leaf.find((e) => e.pointer === '/extra')!.schemaPath).toBe('/additionalProperties')
    const req = leaf.find((e) => e.keyword === 'required')!
    expect(req.message).toBe('Missing required property "city"')
    expect(req.schemaPath).toMatch(/^\/properties\/address\/\$ref|^\/\$defs\/address\/required/)
    // Summaries come after the specific errors
    const firstSummary = r.errors.findIndex((e) => e.summary)
    expect(r.errors.slice(firstSummary).every((e) => e.summary)).toBe(true)
  })
  it('friendly type messages', () => {
    const r = validateDocument('x', { type: ['integer', 'null'] }, '7')
    expect(r.errors[0].message).toBe('Expected integer or null, got string')
  })
  it('respects the draft: draft-4 boolean exclusiveMaximum vs 2020-12 numeric', () => {
    expect(validateDocument(10, { maximum: 10, exclusiveMaximum: true }, '4').valid).toBe(false)
    expect(validateDocument(10, { exclusiveMaximum: 10 }, '2020-12').valid).toBe(false)
    expect(validateDocument(9, { exclusiveMaximum: 10 }, '2020-12').valid).toBe(true)
  })
  it('validates big numbers as numbers', () => {
    const p = parseJson('{"n": 123456789012345678901234567890}')
    if (!p.ok) throw new Error()
    expect(validateDocument(p.value, { properties: { n: { type: 'integer' } } }).valid).toBe(true)
    expect(validateDocument(p.value, { properties: { n: { type: 'string' } } }).valid).toBe(false)
  })
  it('explains unresolvable remote refs and bad schemas', () => {
    expect(() => validateDocument({}, { $ref: 'https://example.com/schema.json' })).toThrow(/remote schemas are never fetched/)
    expect(() => validateDocument({}, [1, 2])).toThrow(/must be a JSON object/)
    expect(validateDocument({ a: 1 }, true).valid).toBe(true)
    expect(validateDocument({ a: 1 }, false).valid).toBe(false)
  })
  it('handles unicode and escaped keys in pointers', () => {
    const r = validateDocument({ 'ключ/x': 'v', '~t': 1 }, { properties: { 'ключ/x': { type: 'number' }, '~t': { type: 'string' } } })
    expect(r.errors.filter((e) => !e.summary).map((e) => e.pointer).sort()).toEqual(['/~0t', '/ключ~1x'])
  })
  it('error pointers locate in the source text', () => {
    const text = '{\n  "id": 1,\n  "roles": ["admin", "root"]\n}'
    const r = runSchemaValidation({ doc: text, schema: JSON.stringify(schema), draft: 'auto' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const e = r.value.errors.find((x) => x.pointer === '/roles/1')!
    const loc = locatePointer(text, e.pointer)!
    expect(loc).toMatchObject({ line: 3, column: 22, exact: true })
    expect(r.value.locations['/roles/1']).toEqual({ line: 3, column: 22, endLine: 3, endColumn: 28, exact: true })
    expect(r.value.locations['/roles']).toMatchObject({ keyLine: 3, keyColumn: 3 })
    // Missing required "email" is reported on the root object
    expect(r.value.locations['']).toMatchObject({ line: 1, column: 1, exact: true })
    expect(r.value.locatedAll).toBe(true)
  })
  it('reports which input failed to parse', () => {
    const a = runSchemaValidation({ doc: '{}', schema: '{', draft: 'auto' })
    expect(!a.ok && a.error.source).toBe('schema')
    const b = runSchemaValidation({ doc: '{"a":}', schema: '{}', draft: 'auto' })
    expect(!b.ok && b.error.source).toBe('document')
  })
})

describe('spurious additionalProperties reports', () => {
  it('a declared property that fails is not also reported as "not allowed"', async () => {
    const { DOC_SAMPLE, SCHEMA_SAMPLE } = await import('@/tools/json/schema/sample')
    const r = validateDocument(JSON.parse(DOC_SAMPLE), JSON.parse(SCHEMA_SAMPLE))
    const leaf = r.errors.filter((e) => !e.summary).map((e) => `${e.pointer} ${e.keyword}`)
    expect(leaf).toEqual([
      '/email format',
      '/age minimum',
      '/roles uniqueItems',
      '/plan/seats type',
      '/addresses/1 required',
      '/addresses/1/country pattern',
      '/nickname additionalProperties',
    ])
    expect(r.errors.some((e) => e.keyword === 'additionalProperties' && /"age"/.test(e.message))).toBe(false)
  })
  it('respects patternProperties and refs', () => {
    const schema = { $defs: { o: { type: 'object', properties: { a: { type: 'string' } }, patternProperties: { '^x-': { type: 'number' } }, additionalProperties: false } }, $ref: '#/$defs/o' }
    const r = validateDocument({ a: 1, 'x-y': 'bad', z: 1 }, schema)
    const leaf = r.errors.filter((e) => !e.summary).map((e) => `${e.pointer} ${e.keyword}`)
    expect(leaf.sort()).toEqual(['/a type', '/x-y type', '/z additionalProperties'])
  })
})

describe('detectDraft', () => {
  it('maps $schema URIs', () => {
    expect(detectDraft({ $schema: 'http://json-schema.org/draft-07/schema#' }).draft).toBe('7')
    expect(detectDraft({ $schema: 'http://json-schema.org/draft-06/schema#' })).toMatchObject({ draft: '7', note: expect.stringMatching(/Draft 6/) })
    expect(detectDraft({ $schema: 'http://json-schema.org/draft-04/schema#' }).draft).toBe('4')
    expect(detectDraft({ $schema: 'https://json-schema.org/draft/2019-09/schema' }).draft).toBe('2019-09')
    expect(detectDraft({})).toMatchObject({ draft: '2020-12', detected: false })
    expect(detectDraft(true).draft).toBe('2020-12')
  })
})

describe('inferSchema', () => {
  it('infers types, required, nested objects, merged array items and formats', () => {
    const s = inferSchema({
      id: 1,
      price: 9.5,
      email: 'ada@example.com',
      created: '2024-05-01T10:00:00Z',
      tags: ['a', 'b'],
      items: [
        { sku: 'A', qty: 1, note: null },
        { sku: 'B', qty: 2.5 },
      ],
      empty: [],
      mixed: [1, 'x'],
    })
    expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(s.type).toBe('object')
    expect(s.required).toEqual(['id', 'price', 'email', 'created', 'tags', 'items', 'empty', 'mixed'])
    const p = s.properties as Record<string, Record<string, unknown>>
    expect(p.id).toEqual({ type: 'integer' })
    expect(p.price).toEqual({ type: 'number' })
    expect(p.email).toEqual({ type: 'string', format: 'email' })
    expect(p.created).toEqual({ type: 'string', format: 'date-time' })
    expect(p.tags).toEqual({ type: 'array', items: { type: 'string' } })
    expect(p.empty).toEqual({ type: 'array' })
    expect(p.mixed).toEqual({ type: 'array', items: { type: ['string', 'integer'] } })
    const items = p.items.items as Record<string, unknown>
    expect(items.required).toEqual(['sku', 'qty'])
    expect((items.properties as Record<string, unknown>).qty).toEqual({ type: 'number' })
    expect((items.properties as Record<string, unknown>).note).toEqual({ type: 'null' })
  })
  it('generated schema validates its own document', () => {
    const doc = { users: [{ id: 1, name: 'A', meta: { tags: ['x'] } }, { id: 2, name: 'B', meta: { tags: [] }, extra: true }], total: 2 }
    const s = inferSchema(doc, { strict: true })
    expect(validateDocument(doc, s).valid).toBe(true)
    expect(validateDocument({ ...doc, surprise: 1 }, s).valid).toBe(false)
  })
  it('mixed object and primitive uses anyOf; options', () => {
    const s = inferSchema([{ a: 1 }, 'x', null], { required: false, formats: false })
    expect(s.type).toBe('array')
    expect((s.items as { anyOf: unknown[] }).anyOf).toEqual([{ type: 'object', properties: { a: { type: 'integer' } } }, { type: ['string', 'null'] }])
  })
  it('generateSchema returns pretty JSON and keeps unicode keys', () => {
    const r = generateSchema({ doc: '{"名前":"x","n":12345678901234567890}' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const s = JSON.parse(r.value)
      expect(s.properties['名前']).toEqual({ type: 'string' })
      expect(s.properties.n).toEqual({ type: 'integer' })
    }
  })
  it('handles a large array quickly', () => {
    const doc = Array.from({ length: 20_000 }, (_, i) => ({ id: i, name: `n${i}`, flag: i % 3 === 0 ? null : true }))
    const s = inferSchema(doc)
    expect(((s.items as Record<string, unknown>).properties as Record<string, unknown>).flag).toEqual({ type: ['boolean', 'null'] })
    expect(validateDocument(doc, s).valid).toBe(true)
  })
})
