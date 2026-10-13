import { describe, expect, it } from 'vitest'
import { csvToJson, DEFAULT_CSV_TO_JSON as D, nestedPaths, parseHeaderPath, type CsvToJsonOptions } from './csv-to-json'
import { jsonToCsv, DEFAULT_JSON_TO_CSV } from './json-to-csv'

const run = (csv: string, o: Partial<CsvToJsonOptions> = {}) => csvToJson(csv, { ...D, ...o })
const value = (csv: string, o: Partial<CsvToJsonOptions> = {}) => JSON.parse(run(csv, o).json)

describe('csvToJson basics', () => {
  it('array of objects with type inference', () => {
    expect(value('name,age,active,zip\nAda,36,true,02134\nBob,,FALSE,10001')).toEqual([
      { name: 'Ada', age: 36, active: true, zip: '02134' },
      { name: 'Bob', age: null, active: false, zip: 10001 },
    ])
  })
  it('long digit strings stay strings and big decimals are not rounded', () => {
    expect(value('id,amount\n12345678901234567890,0.1000000000000000055511')).toEqual([{ id: '12345678901234567890', amount: '0.1000000000000000055511' }])
  })
  it('each inference rule can be turned off', () => {
    expect(value('a,b,c\n1,true,', { numbers: false, booleans: false, emptyAsNull: false })).toEqual([{ a: '1', b: 'true', c: '' }])
  })
  it('trim', () => {
    expect(value(' a , b \n 1 , x ', { trim: true })).toEqual([{ a: 1, b: 'x' }])
    expect(value(' a , b \n 1 , x ', { trim: false })).toEqual([{ ' a ': ' 1 ', ' b ': ' x ' }])
  })
  it('no header row generates column names', () => {
    expect(value('1,2\n3,4', { header: false })).toEqual([
      { column_1: 1, column_2: 2 },
      { column_1: 3, column_2: 4 },
    ])
  })
  it('quoted fields with delimiters, quotes and newlines', () => {
    expect(value('a,b\n"x,y","say ""hi""\nthere"')).toEqual([{ a: 'x,y', b: 'say "hi"\nthere' }])
  })
  it('detects the delimiter and reports it', () => {
    const r = run('a;b\n1;2')
    expect(r.delimiter).toBe(';')
    expect(r.delimiterDetected).toBe(true)
    expect(JSON.parse(r.json)).toEqual([{ a: 1, b: 2 }])
  })
  it('tab-separated with CRLF and a BOM', () => {
    expect(value('﻿a\tb\r\n1\tx\r\n')).toEqual([{ a: 1, b: 'x' }])
  })
  it('skips empty lines when asked', () => {
    expect(value('a\n1\n\n2\n', { skipEmptyLines: true })).toEqual([{ a: 1 }, { a: 2 }])
    expect(value('a\n1\n\n2\n', { skipEmptyLines: false })).toEqual([{ a: 1 }, { a: null }, { a: 2 }])
  })
  it('indentation', () => {
    expect(run('a\n1', { indent: 0 }).json).toBe('[{"a":1}]')
    expect(run('a\n1', { indent: '\t' }).json).toBe('[\n\t{\n\t\t"a": 1\n\t}\n]')
  })
  it('empty input', () => {
    expect(value('')).toEqual([])
  })
})

describe('shapes', () => {
  const csv = 'id,name\n1,Ada\n2,Bob'
  it('array of arrays keeps the header row first', () => {
    expect(value(csv, { shape: 'arrays' })).toEqual([['id', 'name'], [1, 'Ada'], [2, 'Bob']])
  })
  it('object keyed by a column', () => {
    expect(value(csv, { shape: 'keyed', keyColumn: 'name' })).toEqual({ Ada: { id: 1, name: 'Ada' }, Bob: { id: 2, name: 'Bob' } })
  })
  it('keyed warns on duplicates and missing key column', () => {
    const r = run('k,v\na,1\na,2', { shape: 'keyed', keyColumn: 'k' })
    expect(JSON.parse(r.json)).toEqual({ a: { k: 'a', v: 2 } })
    expect(r.issues.find((i) => i.code === 'DuplicateKey')?.row).toBe(3)
    expect(run(csv, { shape: 'keyed', keyColumn: 'nope' }).issues[0].severity).toBe('error')
  })
})

describe('header mapping', () => {
  it('rename and exclude columns', () => {
    expect(value('id,name,secret\n1,Ada,x', { rename: { name: 'fullName' }, exclude: ['secret'] })).toEqual([{ id: 1, fullName: 'Ada' }])
  })
  it('duplicate and blank headers are made unique with a warning', () => {
    const r = run('a,a,\n1,2,3')
    expect(JSON.parse(r.json)).toEqual([{ a: 1, a_2: 2, column_3: 3 }])
    expect(r.issues.filter((i) => i.code === 'HeaderRenamed')).toHaveLength(2)
  })
  it('columns report kind and empty count', () => {
    const r = run('a,b,c\n1,x,\n2,3,')
    expect(r.columns.map((c) => [c.name, c.kind, c.empty])).toEqual([
      ['a', 'number', 0],
      ['b', 'mixed', 0],
      ['c', 'empty', 2],
    ])
  })
})

describe('ragged rows', () => {
  it('short rows are padded and reported with row numbers', () => {
    const r = run('a,b,c\n1,2,3\n4\n5,6')
    expect(JSON.parse(r.json)).toEqual([
      { a: 1, b: 2, c: 3 },
      { a: 4, b: null, c: null },
      { a: 5, b: 6, c: null },
    ])
    const w = r.issues.find((i) => i.code === 'TooFewFields')!
    expect(w.message).toMatch(/rows 3, 4/)
    expect(w.line).toBe(3)
  })
  it('long rows keep the extra fields under generated names', () => {
    const r = run('a,b\n1,2,3')
    expect(JSON.parse(r.json)).toEqual([{ a: 1, b: 2, column_3: 3 }])
    expect(r.issues.find((i) => i.code === 'TooManyFields')!.row).toBe(2)
  })
  it('quote errors carry row and line', () => {
    const r = run('a,b\n1,"oops\n2,3')
    const e = r.issues.find((i) => i.severity === 'error')!
    expect(e.row).toBe(2)
    expect(e.line).toBe(2)
  })
})

describe('nested keys', () => {
  it('parses header paths', () => {
    expect(parseHeaderPath('a.b')).toEqual(['a', 'b'])
    expect(parseHeaderPath('items[0].sku')).toEqual(['items', 0, 'sku'])
    expect(parseHeaderPath('plain')).toBeNull()
    expect(parseHeaderPath('a..b')).toBeNull()
    expect(parseHeaderPath('.a')).toBeNull()
    expect(parseHeaderPath('a.')).toBeNull()
    expect(parseHeaderPath('[0]')).toBeNull()
  })
  it('builds nested objects and arrays', () => {
    expect(value('id,user.name,user.age,tags[0],tags[1]\n1,Ada,36,x,y', { nested: true })).toEqual([{ id: 1, user: { name: 'Ada', age: 36 }, tags: ['x', 'y'] }])
  })
  it('fills sparse array indexes with null', () => {
    expect(value('a[0],a[2]\n1,3', { nested: true })).toEqual([{ a: [1, null, 3] }])
  })
  it('conflicting paths stay flat instead of overwriting', () => {
    const r = run('a,a.b,c.d,c[0]\n1,2,3,4', { nested: true })
    expect(JSON.parse(r.json)).toEqual([{ a: 1, 'a.b': 2, 'c.d': 3, 'c[0]': 4 }])
    expect(r.issues.find((i) => i.code === 'NestedConflict')).toBeTruthy()
    expect(nestedPaths(['x.y', 'x.z']).conflicts).toEqual([])
  })
})

describe('round trip with JSON → CSV', () => {
  it('flattened + expanded CSV nests back to the original', () => {
    const original = [
      { id: 1, user: { name: 'Ada', zip: '02134' }, tags: ['x', 'y'] },
      { id: 2, user: { name: 'Bob, Jr.', zip: '10001' }, tags: ['z', 'w'] },
    ]
    const csv = jsonToCsv(JSON.stringify(original), { ...DEFAULT_JSON_TO_CSV, arrays: 'expand' })
    if (!csv.ok) throw new Error('conversion failed')
    const back = value(csv.csv, { nested: true })
    expect(back).toEqual([
      { id: 1, user: { name: 'Ada', zip: '02134' }, tags: ['x', 'y'] },
      { id: 2, user: { name: 'Bob, Jr.', zip: 10001 }, tags: ['z', 'w'] },
    ])
  })
})

describe('large input', () => {
  it('parses 100k rows', () => {
    let csv = 'id,name,score,zip\n'
    for (let i = 0; i < 100_000; i++) csv += `${i},user ${i},${(i / 3).toFixed(2)},0${i % 9999}\n`
    const t0 = performance.now()
    const r = run(csv, { indent: 0 })
    expect(performance.now() - t0).toBeLessThan(5000)
    expect(r.rowCount).toBe(100_000)
    const v = JSON.parse(r.json)
    expect(v[99_999]).toEqual({ id: 99_999, name: 'user 99999', score: 33333, zip: '0' + (99_999 % 9999) })
  })
})
