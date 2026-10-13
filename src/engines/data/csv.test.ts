import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { BOM, detectDelimiter, detectLinebreak, escapeCsvField, inferValue, kindOf, looksNumeric, normalizeHeaders, readCsv, serializeCsv, DEFAULT_INFER } from './csv'

/** Independent check: whatever we write, papaparse must read back identically. */
function roundTrip(rows: string[][], opts: Parameters<typeof serializeCsv>[1] = {}) {
  const csv = serializeCsv(rows, opts)
  const body = csv.startsWith(BOM) ? csv.slice(1) : csv
  const parsed = Papa.parse<string[]>(body.replace(/(\r\n|\n)$/, ''), { delimiter: opts.delimiter ?? ',' })
  return parsed.data
}

describe('escapeCsvField', () => {
  it('leaves plain fields alone', () => {
    expect(escapeCsvField('hello')).toBe('hello')
    expect(escapeCsvField('')).toBe('')
    expect(escapeCsvField('a;b')).toBe('a;b')
  })
  it('quotes delimiters, quotes and line breaks (RFC 4180)', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"')
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
    expect(escapeCsvField('cr\rhere')).toBe('"cr\rhere"')
    expect(escapeCsvField('crlf\r\n')).toBe('"crlf\r\n"')
    expect(escapeCsvField('"')).toBe('""""')
  })
  it('quotes leading/trailing whitespace so readers do not trim it', () => {
    expect(escapeCsvField(' padded')).toBe('" padded"')
    expect(escapeCsvField('tab\t')).toBe('"tab\t"')
    expect(escapeCsvField('in side')).toBe('in side')
  })
  it('respects custom delimiters, multi-char delimiters and quote-all', () => {
    expect(escapeCsvField('a;b', ';')).toBe('"a;b"')
    expect(escapeCsvField('a,b', ';')).toBe('a,b')
    expect(escapeCsvField('a||b', '||')).toBe('"a||b"')
    expect(escapeCsvField('a|b', '||')).toBe('a|b')
    expect(escapeCsvField('x', ',', '"', true)).toBe('"x"')
    expect(escapeCsvField("it's", ',', "'")).toBe("'it''s'")
  })
})

describe('serializeCsv', () => {
  it('joins rows with LF by default and ends with a newline', () => {
    expect(serializeCsv([['a', 'b'], ['1', '2']])).toBe('a,b\n1,2\n')
  })
  it('supports CRLF, BOM, quote-all and no trailing newline', () => {
    expect(serializeCsv([['a'], ['b']], { lineEnding: 'crlf' })).toBe('a\r\nb\r\n')
    expect(serializeCsv([['a']], { bom: true })).toBe('﻿a\n')
    expect(serializeCsv([['a', '1']], { quote: 'all' })).toBe('"a","1"\n')
    expect(serializeCsv([['a'], ['b']], { trailingNewline: false })).toBe('a\nb')
    expect(serializeCsv([])).toBe('')
  })
  it('writes null and undefined cells as empty fields', () => {
    expect(serializeCsv([[null, undefined, 'x']])).toBe(',,x\n')
  })
  it('round-trips nasty fields through an independent parser', () => {
    const rows = [
      ['id', 'text', 'note'],
      ['1', 'comma, inside', 'quote " inside'],
      ['2', 'multi\nline\r\nfield', '"fully quoted"'],
      ['3', '', ' spaces '],
      ['4', 'unicode — café 東京 👩‍💻', ',,,'],
    ]
    expect(roundTrip(rows)).toEqual(rows)
    expect(roundTrip(rows, { delimiter: ';' })).toEqual(rows)
    expect(roundTrip(rows, { delimiter: '\t', lineEnding: 'crlf' })).toEqual(rows)
    expect(roundTrip(rows, { quote: 'all', bom: true })).toEqual(rows)
  })
})

describe('readCsv', () => {
  it('parses basic CSV and drops the terminating line break', () => {
    const r = readCsv('a,b\n1,2\n')
    expect(r.rows).toEqual([['a', 'b'], ['1', '2']])
    expect(r.delimiter).toBe(',')
    expect(r.issues).toEqual([])
  })
  it('strips a UTF-8 BOM and reports it', () => {
    const r = readCsv('﻿name,age\nAda,36')
    expect(r.rows[0]).toEqual(['name', 'age'])
    expect(r.hadBom).toBe(true)
  })
  it('handles CRLF and quoted fields containing line breaks', () => {
    const r = readCsv('a,b\r\n1,"x\r\ny"\r\n2,z\r\n')
    expect(r.linebreak).toBe('\r\n')
    expect(r.rows).toEqual([['a', 'b'], ['1', 'x\r\ny'], ['2', 'z']])
    expect(Array.from(r.lines)).toEqual([1, 2, 4])
  })
  it('auto-detects semicolon, tab and pipe delimiters', () => {
    expect(readCsv('a;b;c\n1;2;3\n4;5;6').delimiter).toBe(';')
    expect(readCsv('a\tb\n1\t2').delimiter).toBe('\t')
    expect(readCsv('a|b\n1|2').delimiter).toBe('|')
    // Commas inside quotes must not fool the detector.
    expect(readCsv('"x,y";b\n"1,2";3\n"4,5";6').delimiter).toBe(';')
  })
  it('honours an explicit delimiter and quote char', () => {
    const r = readCsv("a,b\n'x,y',2", { delimiter: ',', quoteChar: "'" })
    expect(r.rows[1]).toEqual(['x,y', '2'])
    expect(r.delimiterDetected).toBe(false)
  })
  it('skips blank lines on request but keeps record numbers and lines', () => {
    const r = readCsv('a,b\n\n1,2\n\n3,4', { skipEmptyLines: true })
    expect(r.rows).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
    expect(Array.from(r.recordNumbers)).toEqual([1, 3, 5])
    expect(Array.from(r.lines)).toEqual([1, 3, 5])
  })
  it('keeps ragged rows as-is', () => {
    const r = readCsv('a,b\n1,2,3\n4\n')
    expect(r.rows).toEqual([['a', 'b'], ['1', '2', '3'], ['4']])
  })
  it('reports an unterminated quote with record and line numbers', () => {
    const r = readCsv('a,b\n1,2\n"broken,3\n4,5')
    expect(r.issues.length).toBeGreaterThan(0)
    const e = r.issues.find((i) => i.code === 'MissingQuotes')!
    expect(e.severity).toBe('error')
    expect(e.row).toBe(3)
    expect(e.line).toBe(3)
  })
  it('handles empty input', () => {
    expect(readCsv('').rows).toEqual([])
  })
})

describe('detection helpers', () => {
  it('detectLinebreak', () => {
    expect(detectLinebreak('a\r\nb\r\n')).toBe('\r\n')
    expect(detectLinebreak('a\nb')).toBe('\n')
    expect(detectLinebreak('a\rb\rc')).toBe('\r')
  })
  it('detectDelimiter falls back to comma for single-column data', () => {
    expect(detectDelimiter('one\ntwo\nthree').delimiter).toBe(',')
  })
  it('normalizeHeaders makes names unique and non-empty', () => {
    const r = normalizeHeaders(['id', 'name', 'name', '', ' id '], true)
    expect(r.headers).toEqual(['id', 'name', 'name_2', 'column_4', 'id_2'])
    expect(r.renamed.map((x) => x.index)).toEqual([2, 3, 4])
  })
})

describe('type inference', () => {
  const I = DEFAULT_INFER
  it('numbers', () => {
    expect(inferValue('42', I)).toBe(42)
    expect(inferValue('-3.5', I)).toBe(-3.5)
    expect(inferValue('1e3', I)).toBe(1000)
    expect(inferValue('0', I)).toBe(0)
    expect(inferValue('0.25', I)).toBe(0.25)
  })
  it('keeps leading-zero strings like ZIP codes', () => {
    expect(inferValue('02134', I)).toBe('02134')
    expect(inferValue('007', I)).toBe('007')
    expect(inferValue('-01', I)).toBe('-01')
  })
  it('keeps long digit strings (> 15 digits) and imprecise decimals as strings', () => {
    expect(inferValue('123456789012345', I)).toBe(123456789012345)
    expect(inferValue('1234567890123456', I)).toBe('1234567890123456')
    expect(inferValue('4111111111111111', I)).toBe('4111111111111111')
    expect(inferValue('12345678901234567890', I)).toBe('12345678901234567890')
    expect(inferValue('0.1000000000000000055511', I)).toBe('0.1000000000000000055511')
  })
  it('rejects non-JSON number forms', () => {
    for (const s of ['+5', '.5', '5.', '1,000', '0x1F', ' 42', '42 ', 'NaN', 'Infinity', '1e', '-', '-0']) expect(inferValue(s, I)).toBe(s)
  })
  it('booleans are case-insensitive true/false only', () => {
    expect(inferValue('true', I)).toBe(true)
    expect(inferValue('FALSE', I)).toBe(false)
    expect(inferValue('yes', I)).toBe('yes')
    expect(inferValue('1', { ...I, numbers: false })).toBe('1')
  })
  it('empty → null is toggleable, and every rule can be switched off', () => {
    expect(inferValue('', I)).toBeNull()
    expect(inferValue('', { ...I, emptyAsNull: false })).toBe('')
    expect(inferValue('42', { ...I, numbers: false })).toBe('42')
    expect(inferValue('true', { ...I, booleans: false })).toBe('true')
  })
  it('looksNumeric and kindOf', () => {
    expect(looksNumeric('10')).toBe(true)
    expect(looksNumeric('010')).toBe(false)
    expect(kindOf([1, 2, null])).toBe('number')
    expect(kindOf([1, 'a'])).toBe('mixed')
    expect(kindOf([null, ''])).toBe('empty')
    expect(kindOf([true, false])).toBe('boolean')
  })
})

describe('large input', () => {
  it('writes and reads 50k rows', () => {
    const rows: string[][] = [['id', 'name', 'note']]
    for (let i = 0; i < 50_000; i++) rows.push([String(i), `user ${i}`, i % 7 === 0 ? 'has, comma' : i % 11 === 0 ? 'has "quote"' : 'plain'])
    const csv = serializeCsv(rows)
    const r = readCsv(csv)
    expect(r.rows.length).toBe(50_001)
    expect(r.rows[7]).toEqual(['6', 'user 6', 'plain'])
    expect(r.rows[8]).toEqual(['7', 'user 7', 'has, comma'])
    expect(r.rows[12]).toEqual(['11', 'user 11', 'has "quote"'])
  })
})
