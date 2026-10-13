import { describe, expect, it } from 'vitest'
import { convertList, detectDelimiter, detectDirection, joinItems, LIST_PRESETS, processItems, quoteItem, splitDelimited, splitList, DEFAULT_LIST_OPTIONS } from './list'

const preset = (id: string) => ({ ...DEFAULT_LIST_OPTIONS, ...LIST_PRESETS.find((p) => p.id === id)!.options })

describe('splitDelimited', () => {
  it('splits plain lists', () => {
    expect(splitDelimited('a,b,,c', ',').items).toEqual(['a', 'b', '', 'c'])
    expect(splitDelimited('a, b', ', ').items).toEqual(['a', 'b'])
    expect(splitDelimited('a|b', '|').items).toEqual(['a', 'b'])
    expect(splitDelimited('a\tb', '\t').items).toEqual(['a', 'b'])
    expect(splitDelimited('a\r\nb\nc', '\n').items).toEqual(['a', 'b', 'c'])
    expect(splitDelimited('a,', ',').items).toEqual(['a', ''])
  })

  it('respects quotes containing the delimiter', () => {
    expect(splitDelimited('"a, b", c', ',').items).toEqual(['a, b', ' c'])
    expect(splitDelimited("'x;y';z", ';').items).toEqual(['x;y', 'z'])
    expect(splitDelimited('`a,b`,c', ',').items).toEqual(['a,b', 'c'])
  })

  it('unescapes doubled and backslash-escaped quotes', () => {
    expect(splitDelimited('"say ""hi""",x', ',').items).toEqual(['say "hi"', 'x'])
    expect(splitDelimited("'it\\'s',y", ',').items).toEqual(["it's", 'y'])
    expect(splitDelimited("'O''Brien',z", ',').items).toEqual(["O'Brien", 'z'])
  })

  it('treats quotes inside unquoted fields literally', () => {
    expect(splitDelimited('5" screen, 6\' cable', ',').items).toEqual(['5" screen', " 6' cable"])
  })

  it('reports unterminated quotes', () => {
    const r = splitDelimited('"open, b', ',')
    expect(r.unterminatedQuote).toBe(0)
    expect(r.items).toEqual(['"open', ' b'])
  })

  it('can split without quote awareness', () => {
    expect(splitDelimited('"a, b", c', ',', false).items).toEqual(['"a', ' b"', ' c'])
  })
})

describe('splitList', () => {
  it('parses JSON arrays', () => {
    const r = splitList('["a", "b,c", 3, null]')
    expect(r.json).toBe(true)
    expect(r.items).toEqual(['a', 'b,c', '3', 'null'])
  })

  it('strips wrappers and auto-detects delimiters', () => {
    expect(splitList("('a', 'b', 'c')").items.map((s) => s.trim())).toEqual(['a', 'b', 'c'])
    expect(splitList('{x|y|z}').items).toEqual(['x', 'y', 'z'])
    expect(splitList('a;b;c').delimiter).toBe(';')
    expect(splitList('a\tb').delimiter).toBe('\t')
  })

  it('uses the given delimiter when auto-detection is off', () => {
    expect(splitList('a,b;c', { autoDelimiter: false, delimiter: ';' }).items).toEqual(['a,b', 'c'])
  })
})

describe('detectDelimiter / detectDirection', () => {
  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('"a,b,c";"d"')).toBe(';')
    expect(detectDelimiter('one two three')).toBe(' ')
    expect(detectDelimiter('single')).toBe(',')
  })

  it('detects direction', () => {
    expect(detectDirection('apple\nbanana\ncherry')).toBe('join')
    expect(detectDirection('apple, banana, cherry')).toBe('split')
    expect(detectDirection('["a","b"]')).toBe('split')
    expect(detectDirection('(\n  1,\n  2\n)')).toBe('split')
    expect(detectDirection('single')).toBe('join')
    expect(detectDirection('')).toBe('join')
  })
})

describe('quoting', () => {
  it('quotes with escaping', () => {
    expect(quoteItem("O'Brien", 'single', 'double')).toBe("'O''Brien'")
    expect(quoteItem("O'Brien", 'single', 'backslash')).toBe("'O\\'Brien'")
    expect(quoteItem('say "hi"\n', 'double', 'backslash')).toBe('"say \\"hi\\"\\n"')
    expect(quoteItem('say "hi"', 'double', 'double')).toBe('"say ""hi"""')
    expect(quoteItem('a`b', 'backtick', 'backslash')).toBe('`a\\`b`')
    expect(quoteItem('plain', 'none', 'backslash')).toBe('plain')
  })

  it('CSV quoting only when needed', () => {
    expect(quoteItem('plain', 'csv', 'double', ',')).toBe('plain')
    expect(quoteItem('a,b', 'csv', 'double', ',')).toBe('"a,b"')
    expect(quoteItem('a "q"', 'csv', 'double', ',')).toBe('"a ""q"""')
    expect(quoteItem('line\nbreak', 'csv', 'double', ',')).toBe('"line\nbreak"')
  })

  it('joins with wrappers and bare numbers', () => {
    expect(joinItems(['a', '2', 'c'], { delimiter: ', ', quote: 'single', escape: 'double', bareNumbers: true, wrap: 'parens' })).toBe("('a', 2, 'c')")
    expect(joinItems(['a'], { delimiter: ',', quote: 'none', escape: 'double', bareNumbers: false, wrap: 'braces' })).toBe('{a}')
    expect(joinItems([], { delimiter: ',', quote: 'double', escape: 'backslash', bareNumbers: false, wrap: 'brackets' })).toBe('[]')
  })
})

describe('processItems', () => {
  const base = { trim: true, removeEmpty: true, dedupe: false, dedupeIgnoreCase: false, sort: 'none' as const }
  it('trims, removes empties and dedupes', () => {
    const r = processItems([' a ', '', 'b', 'a', 'B'], { ...base, dedupe: true })
    expect(r.items).toEqual(['a', 'b', 'B'])
    expect(r.removedEmpty).toBe(1)
    expect(r.removedDuplicates).toBe(1)
    expect(processItems(['a', 'A'], { ...base, dedupe: true, dedupeIgnoreCase: true }).items).toEqual(['a'])
  })

  it('sorts', () => {
    expect(processItems(['b', 'a10', 'a2', 'C'], { ...base, sort: 'asc' }).items).toEqual(['C', 'a10', 'a2', 'b'])
    expect(processItems(['b', 'a10', 'a2'], { ...base, sort: 'natural' }).items).toEqual(['a2', 'a10', 'b'])
    expect(processItems(['a', 'c', 'b'], { ...base, sort: 'desc' }).items).toEqual(['c', 'b', 'a'])
    expect(processItems(['ccc', 'a', 'bb'], { ...base, sort: 'length' }).items).toEqual(['a', 'bb', 'ccc'])
  })
})

describe('convertList', () => {
  it('lines → SQL IN clause', () => {
    const r = convertList("alice\nbob\nO'Neil\n42\nbob\n", 'auto', preset('sql-in'))
    expect(r.direction).toBe('join')
    expect(r.output).toBe("('alice', 'bob', 'O''Neil', 42)")
    expect(r.removedDuplicates).toBe(1)
  })

  it('lines → JSON array that parses back', () => {
    const r = convertList('a "quoted"\nback\\slash\nemoji 😀', 'join', preset('json-array'))
    expect(JSON.parse(r.output)).toEqual(['a "quoted"', 'back\\slash', 'emoji 😀'])
  })

  it('lines → CSV row', () => {
    expect(convertList('a\nb, c\nd "e"', 'join', preset('csv-row')).output).toBe('a,"b, c","d ""e"""')
  })

  it('delimited → lines with quoted fields', () => {
    const r = convertList('"a, b", c, \'d\'', 'auto', DEFAULT_LIST_OPTIONS)
    expect(r.direction).toBe('split')
    expect(r.output).toBe('a, b\nc\nd')
    expect(r.count).toBe(3)
  })

  it('splits pretty-printed JSON and SQL lists', () => {
    expect(convertList('[\n  "x",\n  "y"\n]', 'auto').output).toBe('x\ny')
    expect(convertList("(\n  'x',\n  'y'\n)", 'auto').output).toBe('x\ny')
  })

  it('can re-quote items when splitting', () => {
    expect(convertList('a,b', 'split', { quote: 'double', quoteLines: true }).output).toBe('"a"\n"b"')
  })

  it('warns on unterminated quotes', () => {
    expect(convertList('"a, b', 'split').warning).toMatch(/Unterminated quote/)
  })

  it('handles unicode and CRLF input', () => {
    expect(convertList('café\r\n東京\r\n👩‍💻\r\n', 'join', { delimiter: ', ' }).output).toBe('café, 東京, 👩‍💻')
  })

  it('handles empty input', () => {
    expect(convertList('', 'auto').output).toBe('')
    expect(convertList('', 'split').count).toBe(0)
  })

  it('handles a large list', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => `item-${i}`).join('\n')
    const t0 = performance.now()
    const joined = convertList(lines, 'join', preset('json-array'))
    expect(joined.count).toBe(100_000)
    const back = convertList(joined.output, 'auto')
    expect(back.direction).toBe('split')
    expect(back.count).toBe(100_000)
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})
