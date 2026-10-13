import { describe, expect, it } from 'vitest'
import {
  columns,
  compressIpv6,
  csvCell,
  FIELD_TYPES,
  formatRows,
  generateDataset,
  generateRows,
  makeField,
  PRESETS,
  sqlIdent,
  sqlLiteral,
  toCsv,
  toSql,
  typeName,
  validateSchema,
  type Field,
  type FormatOptions,
} from './randomData'
import { FIRST_NAMES, LAST_NAMES, PLACES } from './datasets'

const opts = (o: Partial<FormatOptions> = {}): FormatOptions => ({ format: 'json', tableName: 'users', dialect: 'postgres', batchSize: 100, ...o })

describe('datasets', () => {
  it('are reasonably sized and unique', () => {
    expect(FIRST_NAMES.length).toBeGreaterThan(150)
    expect(LAST_NAMES.length).toBeGreaterThan(100)
    expect(new Set(FIRST_NAMES).size).toBe(FIRST_NAMES.length)
    expect(new Set(LAST_NAMES).size).toBe(LAST_NAMES.length)
    expect(PLACES.length).toBeGreaterThan(100)
    for (const p of PLACES) expect(p.code).toMatch(/^[A-Z]{2}$/)
  })
})

describe('generateRows', () => {
  it('is reproducible with the same seed and differs with another', () => {
    const fields = PRESETS[0].build()
    expect(generateRows(fields, 20, 'abc')).toEqual(generateRows(fields, 20, 'abc'))
    expect(generateRows(fields, 20, 'abd')).not.toEqual(generateRows(fields, 20, 'abc'))
  })

  it('every field type produces a well-formed value', () => {
    const fields: Field[] = FIELD_TYPES.filter((t) => t.type !== 'object').map((t) => makeField(t.type, t.type))
    fields.push(makeField('obj', 'object', {}, { children: [makeField('a', 'integer'), makeField('b', 'city')] }))
    expect(validateSchema(fields)).toEqual([])
    const rows = generateRows(fields, 300, 'all')
    for (const r of rows) {
      expect(r.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(r.email).toMatch(/^[a-z0-9._]+@example\.(com|org|net)$/)
      expect(r.phone).toMatch(/^\+1-\d{3}-555-01\d{2}$/)
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
      expect(r.url).toMatch(/^https:\/\/example\.(com|org|net)\/[a-z]+\/[a-z0-9]{6}$/)
      expect(r.ipv4).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/)
      expect(String(r.ipv6).startsWith('2001:db8:')).toBe(true)
      expect(r.hexColor).toMatch(/^#[0-9a-f]{6}$/)
      expect(typeof r.boolean).toBe('boolean')
      expect(['active', 'pending', 'disabled']).toContain(r.enum)
      expect(Number.isInteger(r.integer)).toBe(true)
      expect(r.integer as number).toBeGreaterThanOrEqual(0)
      expect(r.integer as number).toBeLessThanOrEqual(1000)
      expect(r.float as number).toBeLessThanOrEqual(100)
      expect(String(r.float)).toMatch(/^\d+(\.\d{1,2})?$/)
      expect(r.loremSentence).toMatch(/^[A-Z][a-z ]+\.$/)
      expect(typeof r.obj).toBe('object')
    }
  })

  it('derives email/username from the same person as the name fields', () => {
    const fields = [makeField('first', 'firstName'), makeField('last', 'lastName'), makeField('full', 'fullName'), makeField('email', 'email')]
    for (const r of generateRows(fields, 100, 'p')) {
      expect(r.full).toBe(`${r.first} ${r.last}`)
      const first = String(r.first).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
      expect(String(r.email)).toContain(first[0])
    }
  })

  it('keeps city/country/postcode consistent in a row', () => {
    const fields = [makeField('city', 'city'), makeField('country', 'country'), makeField('cc', 'countryCode'), makeField('zip', 'postcode')]
    for (const r of generateRows(fields, 200, 'loc')) {
      const p = PLACES.find((x) => x.city === r.city)!
      expect(r.country).toBe(p.country)
      expect(r.cc).toBe(p.code)
      if (p.code === 'US') expect(r.zip).toMatch(/^\d{5}$/)
      if (p.code === 'GB') expect(r.zip).toMatch(/^[A-Z]\d \d[A-Z]{2}$/)
    }
  })

  it('auto-increment, date ranges, null probability and boolean probability', () => {
    const fields = [
      makeField('id', 'autoIncrement', { start: 10, step: 5 }),
      makeField('d', 'date', { from: '2024-02-28', to: '2024-03-01' }),
      makeField('n', 'integer', { min: 1, max: 1 }, { nullProbability: 0.5 }),
      makeField('b', 'boolean', { probability: 0.9 }),
      makeField('f', 'float', { min: -1, max: 1, decimals: 0 }),
    ]
    const rows = generateRows(fields, 4000, 'x')
    expect(rows.slice(0, 3).map((r) => r.id)).toEqual([10, 15, 20])
    expect(new Set(rows.map((r) => r.d))).toEqual(new Set(['2024-02-28', '2024-02-29', '2024-03-01']))
    const nulls = rows.filter((r) => r.n === null).length / rows.length
    expect(nulls).toBeGreaterThan(0.45)
    expect(nulls).toBeLessThan(0.55)
    const trues = rows.filter((r) => r.b).length / rows.length
    expect(trues).toBeGreaterThan(0.87)
    expect(trues).toBeLessThan(0.93)
    expect(new Set(rows.map((r) => r.f))).toEqual(new Set([-1, 0, 1]))
  })
})

describe('validateSchema', () => {
  it('reports clear issues', () => {
    const msgs = validateSchema([
      makeField('', 'uuid'),
      makeField('a', 'integer', { min: 5, max: 1 }),
      makeField('a', 'enum', { values: [] }),
      makeField('d', 'date', { from: '2024-13', to: '2024-01-01' }),
      makeField('o', 'object', {}, { children: [makeField('inner', 'object', {}, { children: [makeField('x', 'uuid')] })] }),
      makeField('e', 'object', {}, { children: [] }),
      makeField('w', 'loremWords', { min: 0, max: 3 }),
    ]).map((i) => i.message)
    expect(msgs).toContain('Field name is empty.')
    expect(msgs).toContain('a: min is greater than max.')
    expect(msgs).toContain('Duplicate field name “a”.')
    expect(msgs).toContain('a: list at least one value.')
    expect(msgs).toContain('d: dates must be YYYY-MM-DD.')
    expect(msgs).toContain('inner: objects can only be nested one level deep.')
    expect(msgs).toContain('e: add at least one child field.')
    expect(msgs.some((m) => m.startsWith('w: word count'))).toBe(true)
    expect(validateSchema([])[0].message).toMatch(/at least one field/)
  })
})

describe('CSV', () => {
  it('quotes per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(csvCell(' padded')).toBe('" padded"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(false)).toBe('false')
    expect(csvCell(3.5)).toBe('3.5')
  })
  it('flattens nested objects into dotted columns', () => {
    const fields = [makeField('id', 'autoIncrement'), makeField('addr', 'object', {}, { children: [makeField('city', 'city'), makeField('zip', 'postcode')] })]
    expect(columns(fields).map((c) => c.key)).toEqual(['id', 'addr.city', 'addr.zip'])
    const csv = toCsv(generateRows(fields, 3, 's'), fields)
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe('id,addr.city,addr.zip')
    expect(lines).toHaveLength(4)
    expect(csv.endsWith('\r\n')).toBe(true)
  })
})

describe('SQL', () => {
  it('escapes identifiers and literals per dialect', () => {
    expect(sqlIdent('user"s', 'postgres')).toBe('"user""s"')
    expect(sqlIdent('order', 'mysql')).toBe('`order`')
    expect(sqlIdent('a]b', 'sqlserver')).toBe('[a]]b]')
    expect(sqlLiteral("O'Brien", 'postgres')).toBe("'O''Brien'")
    expect(sqlLiteral('back\\slash', 'mysql')).toBe("'back\\\\slash'")
    expect(sqlLiteral('back\\slash', 'postgres')).toBe("'back\\slash'")
    expect(sqlLiteral('Zoë', 'sqlserver')).toBe("N'Zoë'")
    expect(sqlLiteral(null, 'postgres')).toBe('NULL')
    expect(sqlLiteral(true, 'postgres')).toBe('TRUE')
    expect(sqlLiteral(true, 'sqlite')).toBe('1')
    expect(sqlLiteral({ a: "it's" }, 'postgres')).toBe(`'{"a":"it''s"}'`)
  })
  it('batches INSERT statements', () => {
    const fields = [makeField('id', 'autoIncrement'), makeField('name', 'enum', { values: ["O'Neil"] })]
    const sql = toSql(generateRows(fields, 5, 's'), fields, { tableName: 'people', dialect: 'postgres', batchSize: 2 })
    expect(sql.match(/INSERT INTO "people" \("id", "name"\) VALUES/g)).toHaveLength(3)
    expect(sql).toContain("  (1, 'O''Neil'),\n  (2, 'O''Neil');")
    expect(sql.trimEnd().endsWith(';')).toBe(true)
  })
})

describe('formats', () => {
  const fields = PRESETS[1].build()
  const rows = generateRows(fields, 10, 'fmt')
  it('JSON and NDJSON round-trip', () => {
    expect(JSON.parse(formatRows(rows, fields, opts()))).toEqual(rows)
    const nd = formatRows(rows, fields, opts({ format: 'ndjson' })).trimEnd().split('\n')
    expect(nd).toHaveLength(10)
    expect(nd.map((l) => JSON.parse(l))).toEqual(rows)
  })
  it('TypeScript has an interface with nullable and enum types', () => {
    const ts = formatRows(rows, fields, opts({ format: 'typescript', tableName: 'orders' }))
    expect(ts).toContain('export interface Order {')
    expect(ts).toContain('  status: "pending" | "paid" | "shipped" | "delivered" | "refunded"')
    expect(ts).toContain('  gift_note: string | null')
    expect(ts).toContain('  shipping: { city: string; country_code: string; postcode: string }')
    expect(ts).toContain('export const orders: Order[] = [')
    expect(typeName('user-events')).toBe('UserEvent')
    expect(typeName('123')).toBe('Row123')
  })
})

describe('generateDataset', () => {
  it('generates 100k rows with a preview', () => {
    const fields = PRESETS[0].build()
    const t = performance.now()
    const r = generateDataset({ fields, count: 100_000, seed: 'big', options: opts({ format: 'ndjson' }), previewRows: 200 })
    expect(r.rows).toBe(100_000)
    expect(r.output.trimEnd().split('\n')).toHaveLength(100_000)
    expect(r.preview.trimEnd().split('\n')).toHaveLength(200)
    expect(r.output.startsWith(r.preview)).toBe(true)
    expect(performance.now() - t).toBeLessThan(20_000)
  }, 30_000)
  it('rejects invalid requests', () => {
    expect(() => generateDataset({ fields: [], count: 1, seed: 's', options: opts(), previewRows: 10 })).toThrow(/at least one field/)
    expect(() => generateDataset({ fields: PRESETS[0].build(), count: 100_001, seed: 's', options: opts(), previewRows: 10 })).toThrow(/1–100,000/)
  })
  it('ipv6 compression follows RFC 5952', () => {
    expect(compressIpv6(['2001', 'db8', '0', '0', '0', '0', '0', '1'])).toBe('2001:db8::1')
    expect(compressIpv6(['2001', 'db8', '0', '1', '0', '0', '0', '1'])).toBe('2001:db8:0:1::1')
    expect(compressIpv6(['2001', 'db8', '00a', '1', '2', '3', '4', '5'])).toBe('2001:db8:a:1:2:3:4:5')
  })
})
