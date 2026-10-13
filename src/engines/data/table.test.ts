import { describe, expect, it } from 'vitest'
import { buildDataset, cellAt, exportCsv, exportJson, filterRows, identity, parseColumnFilter, scanContains, sortOrder, type Dataset, type DatasetOptions } from './table'

const O: DatasetOptions = { delimiter: '', quoteChar: '"', header: true, skipEmptyLines: true }
const build = (csv: string, o: Partial<DatasetOptions> = {}) => buildDataset(csv, { ...O, ...o })
const col = (ds: Dataset, c: number) => Array.from({ length: ds.rowCount }, (_, i) => cellAt(ds.columns[c], i))
const rowsOf = (ds: Dataset, order: Int32Array, c: number) => Array.from(order, (i) => cellAt(ds.columns[c], i))

const SAMPLE = `id,name,city,score,joined,active
1,Ada,London,93.5,2021-03-04,true
2,bob,paris,71,2020-11-30,false
3,Chloé,Berlin,,2022-01-15,true
10,dave,London,88,2019-07-01,TRUE
4,Eve,"New York, NY",100,2023-05-20,false
`

describe('buildDataset', () => {
  it('packs columns and reports counts', () => {
    const ds = build(SAMPLE)
    expect(ds.headers).toEqual(['id', 'name', 'city', 'score', 'joined', 'active'])
    expect(ds.rowCount).toBe(5)
    expect(col(ds, 2)).toEqual(['London', 'paris', 'Berlin', 'London', 'New York, NY'])
    expect(ds.delimiter).toBe(',')
    expect(ds.issues).toEqual([])
  })
  it('column stats: type guess, empties, uniques, min/max', () => {
    const ds = build(SAMPLE)
    expect(ds.stats.map((s) => s.type)).toEqual(['integer', 'text', 'text', 'decimal', 'date', 'boolean'])
    expect(ds.stats[3]).toMatchObject({ empty: 1, min: '71', max: '100' })
    expect(ds.stats[2].unique).toBe(4)
    expect(ds.stats[4]).toMatchObject({ min: '2019-07-01', max: '2023-05-20' })
    expect(ds.numeric[0]).not.toBeNull()
    expect(ds.numeric[1]).toBeNull()
  })
  it('without header row generates names', () => {
    const ds = build('1,2\n3,4', { header: false })
    expect(ds.headers).toEqual(['column_1', 'column_2'])
    expect(ds.rowCount).toBe(2)
  })
  it('pads short rows and adds columns for long rows', () => {
    const ds = build('a,b\n1\n2,3,4\n')
    expect(ds.headers).toEqual(['a', 'b', 'column_3'])
    expect(col(ds, 1)).toEqual(['', '3'])
    expect(col(ds, 2)).toEqual(['', '4'])
    expect(ds.raggedRows).toBe(2)
    expect(ds.issues.find((i) => i.code === 'RaggedRows')!.row).toBe(2)
  })
  it('handles quoted newlines, CRLF, BOM and TSV', () => {
    const ds = build('﻿a\tb\r\n"x\r\ny"\t2\r\n')
    expect(ds.delimiter).toBe('\t')
    expect(ds.linebreak).toBe('\r\n')
    expect(col(ds, 0)).toEqual(['x\r\ny'])
  })
  it('reports progress and parse time', () => {
    const phases: string[] = []
    const ds = buildDataset(SAMPLE, O, (p) => phases.push(p.phase))
    expect(phases).toContain('parsing')
    expect(phases.at(-1)).toBe('analyzing')
    expect(ds.parseMs).toBeGreaterThanOrEqual(0)
  })
  it('reports unterminated quotes', () => {
    const ds = build('a,b\n1,"open\n2,3')
    expect(ds.issues[0].severity).toBe('error')
  })
})

describe('filters', () => {
  const ds = build(SAMPLE)
  const all = { global: '', columns: {}, visible: [0, 1, 2, 3, 4, 5] }
  it('global filter is case-insensitive across visible columns', () => {
    expect(rowsOf(ds, filterRows(ds, { ...all, global: 'LONDON' }), 1)).toEqual(['Ada', 'dave'])
    expect(rowsOf(ds, filterRows(ds, { ...all, global: 'chlo' }), 1)).toEqual(['Chloé'])
    expect(filterRows(ds, { ...all, global: 'london', visible: [1] }).length).toBe(0)
  })
  it('matches never span two cells', () => {
    const d = build('a\nfoo\nbar')
    expect(filterRows(d, { global: 'oob', columns: {}, visible: [0] }).length).toBe(0)
  })
  it('special regex characters are literal', () => {
    const d = build('a\n"x.y"\nxzy\n(1)')
    expect(filterRows(d, { global: '.', columns: {}, visible: [0] }).length).toBe(1)
    expect(filterRows(d, { global: '(1', columns: {}, visible: [0] }).length).toBe(1)
  })
  it('column filter language', () => {
    expect(parseColumnFilter('')).toBeNull()
    expect(parseColumnFilter('>10')).toEqual({ kind: 'compare', op: '>', value: 10 })
    expect(parseColumnFilter('5..1')).toEqual({ kind: 'range', lo: 1, hi: 5 })
    expect(parseColumnFilter('=')).toEqual({ kind: 'empty', negate: false })
    expect(parseColumnFilter('!=')).toEqual({ kind: 'empty', negate: true })
    expect(parseColumnFilter('!x')).toEqual({ kind: 'contains', q: 'x', negate: true })
    expect(parseColumnFilter('=Ada')).toEqual({ kind: 'equals', q: 'Ada', negate: false })
    expect(parseColumnFilter('>abc')).toEqual({ kind: 'contains', q: '>abc', negate: false })
  })
  it('numeric, range, empty, equals and negation per column', () => {
    const f = (c: number, e: string) => rowsOf(ds, filterRows(ds, { ...all, columns: { [c]: e } }), 1)
    expect(f(3, '>=88')).toEqual(['Ada', 'dave', 'Eve'])
    expect(f(3, '70..90')).toEqual(['bob', 'dave'])
    expect(f(3, '=')).toEqual(['Chloé'])
    expect(f(3, '!=')).toEqual(['Ada', 'bob', 'dave', 'Eve'])
    expect(f(2, '=london')).toEqual(['Ada', 'dave'])
    expect(f(2, '!lon')).toEqual(['bob', 'Chloé', 'Eve'])
    expect(f(4, '>2021-01-01')).toEqual(['Ada', 'Chloé', 'Eve'])
  })
  it('combines filters and keeps the given order', () => {
    const order = Int32Array.from([4, 3, 2, 1, 0])
    expect(rowsOf(ds, filterRows(ds, { ...all, global: 'e', columns: { 5: '=true' } }, order), 1)).toEqual(['dave', 'Chloé', 'Ada'])
  })
  it('scanContains marks rows', () => {
    const hits = new Uint8Array(ds.rowCount)
    scanContains(ds.columns[1], 'E', hits)
    // 'é' is a different letter from 'e'
    expect(Array.from(hits)).toEqual([0, 0, 0, 1, 1])
  })
})

describe('sortOrder', () => {
  const ds = build(SAMPLE)
  it('numeric-aware ascending/descending, empties last', () => {
    expect(rowsOf(ds, sortOrder(ds.columns[0], ds.numeric[0], 'asc'), 0)).toEqual(['1', '2', '3', '4', '10'])
    expect(rowsOf(ds, sortOrder(ds.columns[3], ds.numeric[3], 'desc'), 3)).toEqual(['100', '93.5', '88', '71', ''])
    expect(rowsOf(ds, sortOrder(ds.columns[3], ds.numeric[3], 'asc'), 3).at(-1)).toBe('')
  })
  it('text is case-insensitive and natural', () => {
    expect(rowsOf(ds, sortOrder(ds.columns[1], null, 'asc'), 1)).toEqual(['Ada', 'bob', 'Chloé', 'dave', 'Eve'])
    const d = build('f\nfile10\nfile2\nfile1')
    expect(rowsOf(d, sortOrder(d.columns[0], null, 'asc'), 0)).toEqual(['file1', 'file2', 'file10'])
  })
  it('dates sort chronologically', () => {
    expect(rowsOf(ds, sortOrder(ds.columns[4], ds.numeric[4], 'asc'), 1)).toEqual(['dave', 'bob', 'Ada', 'Chloé', 'Eve'])
  })
})

describe('export', () => {
  const ds = build(SAMPLE)
  it('CSV of filtered/sorted rows and visible columns, re-quoted', () => {
    const out = exportCsv(ds, Int32Array.from([4, 0]), [1, 2])
    expect(out).toBe('name,city\nEve,"New York, NY"\nAda,London\n')
  })
  it('JSON with typed values', () => {
    const out = JSON.parse(exportJson(ds, Int32Array.from([2]), [0, 1, 3, 5]))
    expect(out).toEqual([{ id: 3, name: 'Chloé', score: null, active: true }])
  })
  it('JSON as strings', () => {
    expect(JSON.parse(exportJson(ds, Int32Array.from([2]), [0], false))).toEqual([{ id: '3' }])
  })
})

describe('large input', () => {
  it('builds, filters and sorts 150k rows quickly', () => {
    const lines = ['id,name,city,amount,date']
    const cities = ['London', 'Paris', 'Berlin', 'Tokyo', 'Lagos']
    for (let i = 0; i < 150_000; i++) lines.push(`${i},user${i},${cities[i % 5]},${((i * 7919) % 10000) / 100},2024-01-${String((i % 28) + 1).padStart(2, '0')}`)
    const csv = lines.join('\n')
    let t = performance.now()
    const ds = build(csv)
    const buildMs = performance.now() - t
    expect(ds.rowCount).toBe(150_000)
    expect(ds.stats[3].type).toBe('decimal')
    t = performance.now()
    const f = filterRows(ds, { global: 'tokyo', columns: { 3: '>50' }, visible: [0, 1, 2, 3, 4] })
    const filterMs = performance.now() - t
    expect(f.length).toBeGreaterThan(10_000)
    t = performance.now()
    const o = sortOrder(ds.columns[3], ds.numeric[3], 'desc')
    const sortMs = performance.now() - t
    expect(cellAt(ds.columns[3], o[0])).toBe('99.99')
    expect(identity(3)).toEqual(Int32Array.from([0, 1, 2]))
    expect(buildMs).toBeLessThan(5000)
    expect(filterMs).toBeLessThan(1000)
    expect(sortMs).toBeLessThan(2000)
  })
})
