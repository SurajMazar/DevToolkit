import { describe, expect, it } from 'vitest'
import { applyOp, extractItems, naturalCompare, OPS, PRESETS, reverseGraphemes, runPipeline, type CleanerOp } from './cleaner'
import { countEols, dominantEol, lineAtOffset, mapLines, reorderLines, splitLines } from './lines'
import { stripHtml } from './html'

const run = (text: string, op: CleanerOp) => applyOp(text, op).text

describe('lines', () => {
  it('splits LF, CRLF and CR and tracks the trailing terminator', () => {
    expect(splitLines('')).toEqual({ lines: [], eols: [], trailing: '' })
    expect(splitLines('a')).toEqual({ lines: ['a'], eols: [''], trailing: '' })
    expect(splitLines('a\r\nb\rc\n')).toEqual({ lines: ['a', 'b', 'c'], eols: ['\r\n', '\r', '\n'], trailing: '\n' })
    expect(splitLines('\n')).toEqual({ lines: [''], eols: ['\n'], trailing: '\n' })
  })
  it('detects the dominant line ending', () => {
    expect(dominantEol('a\r\nb\r\nc\nd')).toBe('\r\n')
    expect(dominantEol('a\nb')).toBe('\n')
    expect(dominantEol('a\rb\rc')).toBe('\r')
    expect(dominantEol('abc')).toBe('\n')
    expect(countEols('a\r\nb\nc\r')).toEqual({ lf: 1, crlf: 1, cr: 1 })
  })
  it('mapLines preserves each line terminator and the trailing newline', () => {
    expect(mapLines('a\r\nb\nc', (l) => l.toUpperCase())).toBe('A\r\nB\nC')
    expect(mapLines('a\n\nb\n', (l) => (l ? l : null))).toBe('a\nb\n')
    expect(mapLines('a\nb', (l) => (l === 'b' ? null : l))).toBe('a')
    expect(mapLines('x\n', () => null)).toBe('')
  })
  it('reorderLines joins with the dominant ending and keeps the trailing newline', () => {
    expect(reorderLines('b\r\na\r\n', (l) => l.sort())).toBe('a\r\nb\r\n')
    expect(reorderLines('', (l) => l)).toBe('')
  })
  it('lineAtOffset', () => {
    expect(lineAtOffset('a\nb\r\nc', 0)).toBe(1)
    expect(lineAtOffset('a\nb\r\nc', 2)).toBe(2)
    expect(lineAtOffset('a\nb\r\nc', 5)).toBe(3)
  })
})

describe('whitespace operations', () => {
  it('trim whole text', () => {
    expect(run('  \n hi \n\t', { kind: 'trim' })).toBe('hi')
    expect(applyOp('x', { kind: 'trim' })).toEqual({ text: 'x', summary: 'no change', changed: false })
  })
  it('trim each line (both / start / end) and reports the count', () => {
    const r = applyOp('  a  \r\n b\nc', { kind: 'trimLines', side: 'both' })
    expect(r.text).toBe('a\r\nb\nc')
    expect(r.summary).toBe('trimmed 2 lines')
    expect(run('  a  ', { kind: 'trimLines', side: 'start' })).toBe('a  ')
    expect(run('  a  ', { kind: 'trimLines', side: 'end' })).toBe('  a')
  })
  it('collapse spaces keeps indentation when asked', () => {
    expect(run('    a   b\t\tc', { kind: 'collapseSpaces', includeTabs: true, keepIndent: true })).toBe('    a b c')
    expect(run('    a   b', { kind: 'collapseSpaces', includeTabs: false, keepIndent: false })).toBe(' a b')
    expect(run('a\t\tb', { kind: 'collapseSpaces', includeTabs: false, keepIndent: true })).toBe('a\t\tb')
    expect(run('a  b', { kind: 'collapseSpaces', includeTabs: true, keepIndent: true })).toBe('a b')
  })
  it('tabs to spaces (fixed and tab stops)', () => {
    expect(run('\tx', { kind: 'tabsToSpaces', size: 2, tabStops: false })).toBe('  x')
    expect(run('ab\tc', { kind: 'tabsToSpaces', size: 4, tabStops: true })).toBe('ab  c')
    expect(run('ab\tc', { kind: 'tabsToSpaces', size: 4, tabStops: false })).toBe('ab    c')
  })
  it('spaces to tabs (leading indentation and all runs)', () => {
    expect(run('        x\n  y', { kind: 'spacesToTabs', size: 4, scope: 'leading' })).toBe('\t\tx\n  y')
    expect(run('      x', { kind: 'spacesToTabs', size: 4, scope: 'leading' })).toBe('\t  x')
    expect(run('a    b        c', { kind: 'spacesToTabs', size: 4, scope: 'all' })).toBe('a\tb\t\tc')
  })
  it('normalizes line endings', () => {
    const r = applyOp('a\r\nb\rc\nd', { kind: 'lineEndings', eol: 'lf' })
    expect(r.text).toBe('a\nb\nc\nd')
    expect(r.summary).toBe('converted 2 line endings to LF')
    expect(run('a\nb', { kind: 'lineEndings', eol: 'crlf' })).toBe('a\r\nb')
    expect(run('a\r\nb', { kind: 'lineEndings', eol: 'cr' })).toBe('a\rb')
  })
})

describe('line operations', () => {
  it('removes blank lines (all / collapse, whitespace-only optional)', () => {
    expect(run('a\n\n  \nb\n', { kind: 'removeBlankLines', mode: 'all', whitespaceIsBlank: true })).toBe('a\nb\n')
    expect(run('a\n\n  \nb', { kind: 'removeBlankLines', mode: 'all', whitespaceIsBlank: false })).toBe('a\n  \nb')
    expect(run('a\n\n\n\nb\n\nc', { kind: 'removeBlankLines', mode: 'collapse', whitespaceIsBlank: true })).toBe('a\n\nb\n\nc')
    expect(applyOp('a\n\nb', { kind: 'removeBlankLines', mode: 'all', whitespaceIsBlank: true }).summary).toBe('removed 1 line')
  })
  it('removes duplicate lines keeping the first occurrence', () => {
    const op: CleanerOp = { kind: 'dedupeLines', caseInsensitive: false, ignoreWhitespace: false, keepBlank: true }
    expect(run('a\nb\na\nc\nb', op)).toBe('a\nb\nc')
    expect(run('a\nA', op)).toBe('a\nA')
    expect(run('a\nA', { ...op, caseInsensitive: true })).toBe('a')
    expect(run('a\n a ', { ...op, ignoreWhitespace: true })).toBe('a')
    expect(run('a\n\nb\n\nc', op)).toBe('a\n\nb\n\nc')
    expect(run('a\n\nb\n\nc', { ...op, keepBlank: false })).toBe('a\n\nb\nc')
    expect(applyOp('x\nx\nx', op).summary).toBe('removed 2 duplicates')
  })
  it('sorts lines: plain, natural, case-insensitive, descending', () => {
    const base = { kind: 'sortLines', order: 'asc', natural: false, locale: false, caseInsensitive: false } as const
    expect(run('b\nB\na\nA', base)).toBe('A\nB\na\nb')
    expect(run('file10\nfile2\nfile1', base)).toBe('file1\nfile10\nfile2')
    expect(run('file10\nfile2\nfile1', { ...base, natural: true })).toBe('file1\nfile2\nfile10')
    expect(run('b\nB\na\nA', { ...base, caseInsensitive: true })).toBe('a\nA\nb\nB')
    expect(run('a\nc\nb', { ...base, order: 'desc' })).toBe('c\nb\na')
    expect(run('é\nz\ne', { ...base, locale: true })).toBe('e\né\nz')
    expect(run('x10\nx9\nX1', { ...base, locale: true, natural: true, caseInsensitive: true })).toBe('X1\nx9\nx10')
    expect(run('b\r\na\r\n', base)).toBe('a\r\nb\r\n')
  })
  it('natural compare handles leading zeros and mixed tokens', () => {
    expect(naturalCompare('a02', 'a2')).toBeGreaterThan(0)
    expect(naturalCompare('a2', 'a10')).toBeLessThan(0)
    expect(naturalCompare('v1.10', 'v1.9')).toBeGreaterThan(0)
    expect(naturalCompare('abc', 'abc')).toBe(0)
  })
  it('reverses lines, words and text', () => {
    expect(run('1\n2\n3\n', { kind: 'reverseLines' })).toBe('3\n2\n1\n')
    expect(run('  hello   big world ', { kind: 'reverseWords' })).toBe('  world   big hello ')
    expect(run('a b\nc d', { kind: 'reverseWords' })).toBe('b a\nd c')
    expect(run('abc', { kind: 'reverseText' })).toBe('cba')
  })
  it('reverses text by grapheme so emoji and combining marks survive', () => {
    expect(reverseGraphemes('a👩‍💻b')).toBe('b👩‍💻a')
    expect(reverseGraphemes('🇳🇵🇯🇵')).toBe('🇯🇵🇳🇵')
    expect(reverseGraphemes('café!')).toBe('!éfac')
    expect(reverseGraphemes('a\r\nb')).toBe('b\r\na')
    expect(reverseGraphemes('')).toBe('')
  })
  it('adds line numbers with padding, separators and start', () => {
    const op = { kind: 'addLineNumbers', start: 1, pad: 'none', separator: '. ', skipBlank: false } as const
    expect(run('a\nb', op)).toBe('1. a\n2. b')
    const ten = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
    expect(run(ten, { ...op, pad: 'zero' }).split('\n')[0]).toBe('01. l0')
    expect(run(ten, { ...op, pad: 'space', separator: ' | ' }).split('\n')[0]).toBe(' 1 | l0')
    expect(run('a\n\nb', { ...op, skipBlank: true, start: 5, separator: '\t' })).toBe('5\ta\n\n6\tb')
  })
  it('removes line numbers in common formats', () => {
    const op = { kind: 'removeLineNumbers' } as const
    expect(run('1. a\n2) b\n3: c\n[4] d\n(5) e\n6\tf\n7 | g', op)).toBe('a\nb\nc\nd\ne\nf\ng')
    // Bare "N text" is stripped only when every line looks numbered.
    expect(run('1 apple\n2 pear', op)).toBe('apple\npear')
    expect(run('2024 was a year\nsomething else', op)).toBe('2024 was a year\nsomething else')
    // Round trip with addLineNumbers.
    const src = 'alpha\nbeta\ngamma'
    expect(run(run(src, { kind: 'addLineNumbers', start: 1, pad: 'space', separator: ': ', skipBlank: false }), op)).toBe(src)
  })
  it('adds prefix and suffix', () => {
    expect(run('a\n\nb', { kind: 'prefixSuffix', prefix: '"', suffix: '",', skipBlank: true })).toBe('"a",\n\n"b",')
    expect(run('a\n', { kind: 'prefixSuffix', prefix: '> ', suffix: '', skipBlank: false })).toBe('> a\n')
  })
})

describe('character operations', () => {
  it('removes special characters (configurable)', () => {
    expect(run('Hello, wörld! ☃ #1 €5 👍', { kind: 'removeSpecial', keepPunctuation: true, extra: '' })).toBe('Hello, wörld!  1 5 ')
    expect(run('a-b_c@d.e', { kind: 'removeSpecial', keepPunctuation: false, extra: '@_' })).toBe('ab_c@de')
    expect(run('a]b^c\\d', { kind: 'removeSpecial', keepPunctuation: false, extra: ']^\\' })).toBe('a]b^c\\d')
  })
  it('removes numbers', () => {
    const r = applyOp('pi is 3.14, total 1,000 and 42', { kind: 'removeNumbers' })
    expect(r.text).toBe('pi is , total  and ')
    expect(r.summary).toBe('removed 3 numbers')
    expect(run('٣ arabic-indic', { kind: 'removeNumbers' })).toBe(' arabic-indic')
  })
  it('removes punctuation, optionally symbols, keeping apostrophes in words', () => {
    expect(run("Don't stop! (yes) — $5 + 3", { kind: 'removePunctuation', symbols: false, keepApostrophes: true })).toBe("Don't stop yes  $5 + 3")
    expect(run("Don't stop! $5", { kind: 'removePunctuation', symbols: true, keepApostrophes: false })).toBe('Dont stop 5')
    expect(run("'quoted'", { kind: 'removePunctuation', symbols: false, keepApostrophes: true })).toBe('quoted')
  })
  it('normalizes Unicode', () => {
    expect(run('é', { kind: 'normalizeUnicode', form: 'NFC' })).toBe('é')
    expect(run('é', { kind: 'normalizeUnicode', form: 'NFD' })).toBe('é')
    expect(run('ﬁ①', { kind: 'normalizeUnicode', form: 'NFKC' })).toBe('fi1')
    expect(applyOp('é', { kind: 'normalizeUnicode', form: 'NFD' }).summary).toBe('normalized to NFD (+1 code units)')
  })
})

describe('HTML stripping (tokenizer, no DOM)', () => {
  it('keeps text, drops tags, scripts, styles and comments', () => {
    const html = '<p>Hello <b>world</b></p><script>alert("x<p>")</script><style>p{}</style><!-- c --><div>Next &amp; last</div>'
    expect(stripHtml(html).text).toBe('Hello world\nNext & last')
  })
  it('handles quoted ">" in attributes, bare "<" and CDATA', () => {
    expect(stripHtml('<a title="a > b" href=\'x\'>link</a> 1 < 2').text).toBe('link 1 < 2')
    expect(stripHtml('<![CDATA[raw <b>]]>').text).toBe('raw <b>')
  })
  it('optionally keeps entities encoded and flattens blocks', () => {
    expect(stripHtml('<p>a&nbsp;&lt;b&gt;</p><p>c</p>', { decodeEntities: false, blockNewlines: false }).text).toBe('a&nbsp;&lt;b&gt;c')
    expect(stripHtml('a<br>b<br/>c').text).toBe('a\nb\nc')
    expect(stripHtml('&#x1F600; &mdash; &copy').text).toBe('😀 — ©')
  })
  it('tables become tab separated rows', () => {
    expect(stripHtml('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>').text).toBe('a\tb\nc\td')
  })
  it('never treats unterminated input as executable — just text', () => {
    expect(stripHtml('<img src=x onerror=alert(1)').text).toBe('')
    expect(stripHtml('<script>never closed').text).toBe('')
  })
  it('summary counts tags and entities', () => {
    expect(applyOp('<b>a</b> &amp;', { kind: 'stripHtml', decodeEntities: true, blockNewlines: true }).summary).toBe('removed 2 tags, decoded 1 entity')
  })
})

describe('extraction', () => {
  const text = `Contact Ana <ana.lopez@example.com>, bob+tag@mail.co.uk or ANA.LOPEZ@EXAMPLE.COM.
See https://example.com/docs?a=1&b=2, (https://en.wikipedia.org/wiki/Foo_(bar)) and www.test.dev.
Follow @dev_team and @ana.lopez — #release2024 #v2 #123 page#anchor &#39;
Prices: -12.5, +3, 1,000,000 and 2.5e3; v2 doesn't count but 10px does.`
  it('emails', () => {
    expect(extractItems(text, 'emails')).toEqual(['ana.lopez@example.com', 'bob+tag@mail.co.uk', 'ANA.LOPEZ@EXAMPLE.COM'])
  })
  it('URLs, trimming trailing punctuation but keeping balanced parens', () => {
    expect(extractItems(text, 'urls')).toEqual(['https://example.com/docs?a=1&b=2', 'https://en.wikipedia.org/wiki/Foo_(bar)', 'www.test.dev'])
  })
  it('hashtags and mentions', () => {
    expect(extractItems(text, 'hashtags')).toEqual(['#release2024', '#v2'])
    expect(extractItems(text, 'mentions')).toEqual(['@dev_team', '@ana.lopez'])
  })
  it('numbers', () => {
    expect(extractItems("Prices: -12.5, +3, 1,000,000 and 2.5e3; v2 and ID7 don't count but 10px and 5kg do. 1,2,3 a-4", 'numbers')).toEqual(['-12.5', '+3', '1,000,000', '2.5e3', '10', '5', '1', '2', '3', '4'])
    expect(extractItems('', 'numbers')).toEqual([])
  })
  it('letters (words of letters only)', () => {
    expect(extractItems('abc123 déjà-vu 東京', 'letters')).toEqual(['abc', 'déjà', 'vu', '東京'])
  })
  it('one per line with case-insensitive dedupe for emails', () => {
    const r = applyOp(text, { kind: 'extract', what: 'emails', dedupe: true })
    expect(r.text).toBe('ana.lopez@example.com\nbob+tag@mail.co.uk')
    expect(r.summary).toBe('extracted 2 emails (1 duplicate dropped)')
    expect(applyOp('', { kind: 'extract', what: 'urls', dedupe: true }).summary).toBe('extracted 0 URLs')
  })
})

describe('pipeline', () => {
  it('runs enabled steps in order and reports each', () => {
    const r = runPipeline('  b\n\na\n  b  \n', [
      { id: '1', enabled: true, op: { kind: 'trimLines', side: 'both' } },
      { id: '2', enabled: false, op: { kind: 'reverseLines' } },
      { id: '3', enabled: true, op: { kind: 'removeBlankLines', mode: 'all', whitespaceIsBlank: true } },
      { id: '4', enabled: true, op: { kind: 'dedupeLines', caseInsensitive: false, ignoreWhitespace: true, keepBlank: true } },
      { id: '5', enabled: true, op: { kind: 'sortLines', order: 'asc', natural: true, locale: true, caseInsensitive: true } },
    ])
    expect(r.output).toBe('a\nb\n')
    expect(r.steps.map((s) => s.summary)).toEqual(['trimmed 2 lines', 'disabled', 'removed 1 line', 'removed 1 duplicate', 'sorted 2 lines'])
    expect(r.steps[1].skipped).toBe(true)
    expect(r.steps.at(-1)!.length).toBe(4)
  })
  it('order matters', () => {
    const a = runPipeline('b\na', [
      { id: '1', enabled: true, op: { kind: 'addLineNumbers', start: 1, pad: 'none', separator: '. ', skipBlank: false } },
      { id: '2', enabled: true, op: { kind: 'sortLines', order: 'desc', natural: true, locale: false, caseInsensitive: false } },
    ])
    expect(a.output).toBe('2. a\n1. b')
  })
  it('empty input and empty pipeline', () => {
    expect(runPipeline('', PRESETS[0].ops.map((op, i) => ({ id: String(i), enabled: true, op }))).output).toBe('')
    expect(runPipeline('same', []).output).toBe('same')
  })
  it('every op has a default and every preset runs', () => {
    const sample = '<p>Hi  there</p>\n\tfoo@bar.com\nfoo@bar.com\n\n#tag @me https://x.dev 42\n'
    for (const o of OPS) expect(() => applyOp(sample, o.defaults)).not.toThrow()
    for (const p of PRESETS) expect(typeof runPipeline(sample, p.ops.map((op, i) => ({ id: String(i), enabled: true, op }))).output).toBe('string')
  })
  it('handles large input quickly', () => {
    const big = Array.from({ length: 100_000 }, (_, i) => `  item ${i % 5000}  `).join('\r\n')
    const t0 = performance.now()
    const r = runPipeline(big, PRESETS.find((p) => p.id === 'sort-unique')!.ops.map((op, i) => ({ id: String(i), enabled: true, op })))
    expect(r.output.split('\r\n')).toHaveLength(5000)
    expect(r.output.startsWith('item 0\r\nitem 1\r\nitem 2\r\n')).toBe(true)
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})
